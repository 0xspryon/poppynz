import { FamilySearchIndex, type FamilySearchDocument, buildFamilySearchDocument, getFamilySearchMinRadiusKm } from "@repo/typesense";
import { ApprovalRepo, DBNotFoundError, FamilySearchRepo, UserProfileRepo } from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions, type UserAndSession } from "@/api/lib/effect-auth";
import { presignProfileImageUrl } from "@/api/lib/profile-image";
import { scheduleFamilySearchReconcile } from "@/api/lib/family-search-jobs";
import { FamilySearchRequestValidationError, validateFamilySearchQuery } from "./families.validator";

class ProviderNotApprovedError extends Data.TaggedError("ProviderNotApprovedError")<{}> { }

// The familySearch permission says who MAY search; a live approval says who
// may search RIGHT NOW. Admins carry the permission without an approval row,
// so only service-provider callers go through the approval lookup.
const ensureApprovedProvider = (userAndSession: UserAndSession) =>
  userAndSession.user.role === "service-provider"
    ? ApprovalRepo.pipe(
      Effect.flatMap((repo) => repo.findCurrentByUserId(userAndSession.user.id)),
      Effect.catchTag("DBNotFoundError", () => Effect.fail(new ProviderNotApprovedError())),
      Effect.asVoid,
    )
    : Effect.void;

const publicFamily = (family: {
  userId: string;
  displayName: string | null;
  shortBio: string | null;
  city: string;
  stateProvince: string;
  country: string | null;
  services: Array<string>;
  serviceDescriptions: Array<string>;
  distanceKm?: number;
}, imageUrl: string | null) => ({
  userId: family.userId,
  displayName: family.displayName,
  shortBio: family.shortBio,
  image: imageUrl,
  location: {
    city: family.city,
    stateProvince: family.stateProvince,
    country: family.country,
  },
  services: family.services,
  serviceDescriptions: family.serviceDescriptions,
  distanceKm: family.distanceKm,
});

const publicFamilyDetail = (candidate: Parameters<typeof buildFamilySearchDocument>[0], imageUrl: string | null) => {
  const document = buildFamilySearchDocument(candidate);
  if (!document) return null;

  return {
    userId: document.userId,
    displayName: document.displayName,
    shortBio: document.shortBio,
    image: imageUrl,
    location: {
      city: document.city,
      stateProvince: document.stateProvince,
      country: document.country,
    },
    services: candidate.services
      .filter((service) => service.deletedAt === null)
      .map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
      })),
  };
};

export const searchFamiliesRouteProgram = (headers: Headers, query: Record<string, string | undefined>) =>
  Effect.gen(function*() {
    const input = yield* validateFamilySearchQuery(query);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { familySearch: ["read"] })(authenticated);
    yield* ensureApprovedProvider(userAndSession);
    const minRadiusKm = yield* getFamilySearchMinRadiusKm.pipe(Effect.orElseSucceed(() => 10));

    let center: [number, number] | undefined;
    if (input.radiusKm !== undefined) {
      if (input.radiusKm < minRadiusKm) {
        return yield* Effect.fail(new FamilySearchRequestValidationError({ message: `radiusKm must be at least ${minRadiusKm}.` }));
      }

      const profileRepo = yield* UserProfileRepo;
      const profile = yield* profileRepo.findByUserId(userAndSession.user.id);
      if (typeof profile.latitude !== "number" || typeof profile.longitude !== "number") {
        return yield* Effect.fail(new FamilySearchRequestValidationError({ message: "A saved location is required for radius search." }));
      }
      center = [profile.latitude, profile.longitude];
    }

    const index = yield* FamilySearchIndex;
    const repo = yield* FamilySearchRepo;

    // Typesense only nominates ranked candidates; the DB is the authority on
    // eligibility (role, ban, active needed services) and on the data we
    // return. Over-fetch candidates and keep scanning until the requested
    // page is full, so stale index entries can't leave holes in a page.
    const needed = input.page * input.perPage;
    const candidatePerPage = Math.min(250, input.perPage * 2);
    const maxCandidatePages = Math.ceil(needed / candidatePerPage) + 2;

    const verified: Array<FamilySearchDocument & { distanceKm?: number }> = [];
    const staleUserIds: Array<string> = [];
    let indexTotal = 0;
    let exhausted = false;

    for (let candidatePage = 1; verified.length < needed && candidatePage <= maxCandidatePages; candidatePage += 1) {
      const result = yield* index.searchFamilies({
        q: input.q,
        city: input.city,
        service: input.service,
        radiusKm: input.radiusKm,
        center,
        page: candidatePage,
        perPage: candidatePerPage,
        sort: input.sort,
      });
      indexTotal = result.pagination.total;

      if (result.families.length === 0) {
        exhausted = true;
        break;
      }

      const candidates = yield* repo.listCandidatesByUserIds(result.families.map((hit) => hit.userId));
      const candidateByUserId = new Map(candidates.map((candidate) => [candidate.profile.userId, candidate]));

      for (const hit of result.families) {
        const candidate = candidateByUserId.get(hit.userId);
        const document = candidate ? buildFamilySearchDocument(candidate) : null;
        if (document) verified.push({ ...document, distanceKm: hit.distanceKm });
        else staleUserIds.push(hit.userId);
      }

      if (candidatePage * candidatePerPage >= indexTotal) {
        exhausted = true;
        break;
      }
    }

    // Candidates the DB rejected are stale index entries; a reconcile removes them.
    yield* Effect.forEach(staleUserIds, scheduleFamilySearchReconcile, { discard: true });

    const pageStart = (input.page - 1) * input.perPage;
    const pageOfFamilies = verified.slice(pageStart, pageStart + input.perPage);
    const total = exhausted ? verified.length : Math.max(indexTotal - staleUserIds.length, verified.length);

    const families = yield* Effect.forEach(
      pageOfFamilies,
      (family) =>
        presignProfileImageUrl(family.image).pipe(
          Effect.map((imageUrl) => publicFamily(family, imageUrl)),
        ),
      { concurrency: 5 },
    );

    // City facet options for the filter dropdown, respecting the other active
    // filters (q/service/radius) but not city itself.
    const cityFacets = yield* index.listCityFacets({
      q: input.q,
      service: input.service,
      radiusKm: input.radiusKm,
      center,
      page: 1,
      perPage: input.perPage,
      sort: input.sort,
    });

    return { families, pagination: { page: input.page, perPage: input.perPage, total }, facets: { city: cityFacets } };
  });

export const getFamilyRouteProgram = (headers: Headers, userId: string) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { familySearch: ["read"] })(authenticated);
    yield* ensureApprovedProvider(userAndSession);
    const repo = yield* FamilySearchRepo;
    const candidate = yield* repo.findCandidateByUserId(userId);
    const imageUrl = yield* presignProfileImageUrl(candidate.profile.image);
    const family = publicFamilyDetail(candidate, imageUrl);

    if (!family) return yield* Effect.fail(new DBNotFoundError({ entity: "family", value: userId }));
    return family;
  });

type FamiliesRouteError =
  | Effect.Effect.Error<ReturnType<typeof searchFamiliesRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getFamilyRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: FamiliesRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "ProviderNotApprovedError":
      return c.json({ error: { code: "PROVIDER_NOT_APPROVED" as const, message: "Family search is available once your profile is approved." } }, 403);
    case "FamilySearchRequestValidationError":
      return c.json({ error: { code: "INVALID_FAMILY_SEARCH" as const, message: error.message } }, 400);
    case "FamilySearchIndexError":
      return c.json({ error: { code: "FAMILY_SEARCH_FAILED" as const, message: "Unable to search families." } }, 502);
    case "ProfileImageUrlError":
      return c.json({ error: { code: "FAMILY_IMAGE_URL_FAILED" as const, message: "Unable to create a profile image link." } }, 502);
    case "DBNotFoundError":
      return c.json({ error: { code: "FAMILY_NOT_FOUND" as const, message: "Family was not found." } }, 404);
    case "SqlError":
      return c.json({ error: { code: "FAMILY_SEARCH_PROFILE_LOOKUP_FAILED" as const, message: "Unable to load search profile." } }, 500);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, FamiliesRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return errorToResponse(c, failure.value);
      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);
    },
  });

export async function searchFamiliesHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const exit = await runtime.runPromiseExit(searchFamiliesRouteProgram(c.req.raw.headers, {
    q: c.req.query("q"),
    city: c.req.query("city"),
    service: c.req.query("service"),
    radiusKm: c.req.query("radiusKm"),
    sort: c.req.query("sort"),
    page: c.req.query("page"),
    perPage: c.req.query("perPage"),
    lat: c.req.query("lat"),
    lng: c.req.query("lng"),
  }));
  return exitToResponse(c, exit);
}

export async function getFamilyHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const exit = await runtime.runPromiseExit(getFamilyRouteProgram(c.req.raw.headers, c.req.param("userId") ?? ""));
  return exitToResponse(c, exit);
}
