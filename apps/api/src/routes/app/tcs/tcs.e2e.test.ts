import {
  EmptyApprovalRepoTest,
  EmptyApprovalRequestRepoTest,
  EmptyKycDocumentRepoTest,
  EmptyKycDocumentTypeRepoTest,
  EmptyServiceCatalogueRepoTest,
  EmptyServiceOfferedRepoTest,
  EmptySignupIntentRepoTest,
  EmptyUserProfileRepoTest,
  DBNotFoundError,
  makeSessionRepoTest,
  makeTcDocumentRepoTest,
  makeUserRepoTest,
  type Session,
  type TcAcceptanceInput,
  type TcAudienceRole,
  type TcDocument,
  type TcDocumentAcceptance,
  type TcDocumentCreateInput,
  type TcDocumentUpdateInput,
  type TcDocumentVersion,
  type TcDraftInput,
  type TcDraftUpdateInput,
  type User,
} from "@repo/db";
import { makeGooglePlacesTest } from "@repo/google";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeObjectStorageTest } from "@repo/objs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../index";
import { makeAuthServiceTest, type AuthSession } from "../../../lib/effect-auth";
import { EmptySigninServiceTest } from "../auth/signin/signin.handler";
import { EmptySignupServiceTest } from "../auth/signup/signup.handler";

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  name: "Fam Ily",
  email: "family@example.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  isAnonymous: false,
  role: "family",
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides,
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  expiresAt: new Date("2026-07-02T00:00:00.000Z"),
  token: "session-token",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  ipAddress: null,
  userAgent: null,
  userId: "user-1",
  impersonatedBy: null,
  activeOrganizationId: null,
  ...overrides,
});

const makeDoc = (overrides: Partial<TcDocument> = {}): TcDocument => ({
  id: `doc-${crypto.randomUUID()}`,
  slug: "terms_of_service",
  title: "Terms of Service",
  appliesToRole: "all",
  deletedAt: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  ...overrides,
});

const makeVersion = (overrides: Partial<TcDocumentVersion> = {}): TcDocumentVersion => ({
  id: `version-${crypto.randomUUID()}`,
  documentId: "doc-1",
  version: 1,
  description: "Initial version",
  content: "# Terms",
  checkboxLabel: "I agree to the terms.",
  publishedAt: new Date("2026-07-01T00:00:00.000Z"),
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  ...overrides,
});

const makeInMemoryTcRepo = (
  documents: Array<TcDocument>,
  versions: Array<TcDocumentVersion>,
  acceptances: Array<TcDocumentAcceptance>,
) => {
  const activeDocuments = () => documents.filter((document) => document.deletedAt === null);
  const publishedForRole = (role: TcAudienceRole) =>
    activeDocuments()
      .filter((document) => document.appliesToRole === role || document.appliesToRole === "all")
      .flatMap((document) => {
        const latest = versions
          .filter((version) => version.documentId === document.id && version.publishedAt !== null)
          .sort((a, b) => b.version - a.version)[0];
        return latest ? [{ document, version: latest }] : [];
      });

  return {
    listActive: () => Effect.succeed(activeDocuments()),
    findActiveById: (id: string) => {
      const document = activeDocuments().find((candidate) => candidate.id === id);
      return document ? Effect.succeed(document) : Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: id }));
    },
    findActiveBySlug: (slug: string) => {
      const document = activeDocuments().find((candidate) => candidate.slug === slug);
      return document ? Effect.succeed(document) : Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: slug }));
    },
    createDocument: (input: TcDocumentCreateInput) => {
      const document = makeDoc({ ...input });
      documents.push(document);
      return Effect.succeed(document);
    },
    updateDocument: (id: string, input: TcDocumentUpdateInput) => {
      const document = activeDocuments().find((candidate) => candidate.id === id);
      if (!document) return Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: id }));
      Object.assign(document, input);
      return Effect.succeed(document);
    },
    softDeleteDocument: (id: string) => {
      const document = activeDocuments().find((candidate) => candidate.id === id);
      if (!document) return Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: id }));
      document.deletedAt = new Date("2026-07-02T00:00:00.000Z");
      return Effect.succeed(document);
    },
    listVersions: (documentId: string) =>
      Effect.succeed(
        versions.filter((version) => version.documentId === documentId).sort((a, b) => b.version - a.version),
      ),
    listVersionsByDocumentIds: (documentIds: Array<string>) =>
      Effect.succeed(
        versions.filter((version) => documentIds.includes(version.documentId)).sort((a, b) => b.version - a.version),
      ),
    createDraft: (documentId: string, input: TcDraftInput) => {
      const document = activeDocuments().find((candidate) => candidate.id === documentId);
      if (!document) return Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: documentId }));
      const latest = versions
        .filter((version) => version.documentId === documentId)
        .sort((a, b) => b.version - a.version)[0];
      const draft = makeVersion({ ...input, documentId, version: (latest?.version ?? 0) + 1, publishedAt: null });
      versions.push(draft);
      return Effect.succeed(draft);
    },
    updateDraft: (documentId: string, input: TcDraftUpdateInput) => {
      const draft = versions.find((version) => version.documentId === documentId && version.publishedAt === null);
      if (!draft) return Effect.fail(new DBNotFoundError({ entity: "tcDocumentVersion", value: documentId }));
      Object.assign(draft, input);
      return Effect.succeed(draft);
    },
    publishDraft: (documentId: string) => {
      const draft = versions.find((version) => version.documentId === documentId && version.publishedAt === null);
      if (!draft) return Effect.fail(new DBNotFoundError({ entity: "tcDocumentVersion", value: documentId }));
      draft.publishedAt = new Date("2026-07-03T00:00:00.000Z");
      return Effect.succeed(draft);
    },
    findLatestPublished: (documentId: string) => {
      const latest = versions
        .filter((version) => version.documentId === documentId && version.publishedAt !== null)
        .sort((a, b) => b.version - a.version)[0];
      return latest
        ? Effect.succeed(latest)
        : Effect.fail(new DBNotFoundError({ entity: "tcDocumentVersion", value: documentId }));
    },
    listPublishedForRole: (role: TcAudienceRole) => Effect.succeed(publishedForRole(role)),
    listPendingForUser: (userId: string, role: TcAudienceRole) =>
      Effect.succeed(
        publishedForRole(role).filter(
          (entry) => !acceptances.some((acceptance) => acceptance.userId === userId && acceptance.versionId === entry.version.id),
        ),
      ),
    listAcceptancesForUser: (userId: string) =>
      Effect.succeed(acceptances.filter((acceptance) => acceptance.userId === userId)),
    insertAcceptances: (userId: string, items: Array<TcAcceptanceInput>) => {
      const inserted = items
        .filter((item) => !acceptances.some((existing) => existing.userId === userId && existing.versionId === item.versionId))
        .map((item) => ({
          ...item,
          id: `acceptance-${crypto.randomUUID()}`,
          userId,
          acceptedAt: new Date("2026-07-01T12:00:00.000Z"),
        }));
      acceptances.push(...inserted);
      return Effect.succeed(inserted);
    },
  };
};

const makeApp = (options: {
  authSession?: AuthSession | null;
  hasPermission?: boolean;
  user?: User;
  documents?: Array<TcDocument>;
  versions?: Array<TcDocumentVersion>;
  acceptances?: Array<TcDocumentAcceptance>;
} = {}) => {
  const user = options.user ?? makeUser();
  const authSession = options.authSession === undefined ? { user: { id: user.id }, session: { id: "session-1" } } : options.authSession;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeAuthServiceTest({
        getSession: () => Effect.succeed(authSession),
        userHasPermission: () => Effect.succeed(options.hasPermission ?? true),
      }),
      EmptySignupIntentRepoTest,
      EmptySigninServiceTest,
      EmptySignupServiceTest,
      EmptyUserProfileRepoTest,
      EmptyApprovalRepoTest,
      EmptyApprovalRequestRepoTest,
      EmptyKycDocumentRepoTest,
      EmptyKycDocumentTypeRepoTest,
      EmptyServiceCatalogueRepoTest,
      EmptyServiceOfferedRepoTest,
      makeGooglePlacesTest({ lookupPlaceById: () => Effect.die("not used"), autocompletePlaces: () => Effect.succeed([]) }),
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: () => Effect.succeed({ uploadUrl: "https://example.com", expiresAt: new Date() }),
        createPresignedGetUrl: () => Effect.succeed({ url: "https://example.com", expiresAt: new Date() }),
      }),
      makeTcDocumentRepoTest(
        makeInMemoryTcRepo(options.documents ?? [], options.versions ?? [], options.acceptances ?? []),
      ),
      makeUserRepoTest({
        findById: (id) => id === user.id ? Effect.succeed(user) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
        findByEmail: () => Effect.succeed(user),
      }),
      makeSessionRepoTest({
        findById: (id) => id === "session-1" ? Effect.succeed(makeSession({ userId: user.id })) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
      }),
    ),
  );

  return createApp(runtime);
};

describe("/tcs", () => {
  it("serves published documents for a requested role without a session", async () => {
    const doc = makeDoc({ id: "doc-1" });
    const spDoc = makeDoc({ id: "doc-sp", slug: "service_provider_fee_acceptance", appliesToRole: "service-provider" });
    const app = makeApp({
      authSession: null,
      documents: [doc, spDoc],
      versions: [makeVersion({ id: "v-1", documentId: "doc-1" }), makeVersion({ id: "v-sp", documentId: "doc-sp" })],
    });

    const res = await app.request("/api/v1/tcs/service-provider");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((entry: { slug: string }) => entry.slug).sort()).toEqual([
      "service_provider_fee_acceptance",
      "terms_of_service",
    ]);
  });

  it("rejects an unsupported role param", async () => {
    const app = makeApp({ authSession: null });
    const res = await app.request("/api/v1/tcs/superuser");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_TC_INPUT");
  });

  it("runs the full accept → publish v2 → re-accept loop", async () => {
    const doc = makeDoc({ id: "doc-1" });
    const versions = [makeVersion({ id: "v-1", documentId: "doc-1" })];
    const acceptances: Array<TcDocumentAcceptance> = [];
    const state = { documents: [doc], versions, acceptances };
    const familyApp = makeApp({ ...state });
    const adminApp = makeApp({ ...state, user: makeUser({ id: "admin-1", role: "admin" }) });

    // 1. The family user has the initial terms pending and accepts them.
    const pending1 = await familyApp.request("/api/v1/me/tcs/pending");
    expect(pending1.status).toBe(200);
    const pendingBody1 = await pending1.json();
    expect(pendingBody1).toHaveLength(1);
    expect(pendingBody1[0]).toMatchObject({ slug: "terms_of_service", versionId: "v-1", version: 1 });

    const accept1 = await familyApp.request("/api/v1/me/tcs/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptances: [{ slug: "terms_of_service", versionId: "v-1" }] }),
    });
    expect(accept1.status).toBe(200);
    expect((await accept1.json()).accepted[0]).toMatchObject({ slug: "terms_of_service", version: 1, userId: "user-1" });

    const pending2 = await familyApp.request("/api/v1/me/tcs/pending");
    expect(await pending2.json()).toEqual([]);

    // 2. The admin drafts and publishes version 2 with a change description.
    const draftRes = await adminApp.request("/api/v1/admin/tcs/doc-1/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Clarified fees", content: "# Terms v2", checkboxLabel: "I agree to the new terms." }),
    });
    expect(draftRes.status).toBe(200);
    const draft = await draftRes.json();
    expect(draft).toMatchObject({ version: 2, publishedAt: null });

    const publishRes = await adminApp.request("/api/v1/admin/tcs/doc-1/publish", { method: "POST" });
    expect(publishRes.status).toBe(200);
    expect((await publishRes.json()).publishedAt).not.toBeNull();

    // 3. The user must re-accept: pending again at version 2, stale accepts rejected.
    const pending3 = await familyApp.request("/api/v1/me/tcs/pending");
    const pendingBody3 = await pending3.json();
    expect(pendingBody3).toHaveLength(1);
    expect(pendingBody3[0]).toMatchObject({ version: 2, checkboxLabel: "I agree to the new terms." });

    const staleAccept = await familyApp.request("/api/v1/me/tcs/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptances: [{ slug: "terms_of_service", versionId: "v-1" }] }),
    });
    expect(staleAccept.status).toBe(409);
    expect((await staleAccept.json()).error.code).toBe("TC_VERSION_STALE");

    const accept2 = await familyApp.request("/api/v1/me/tcs/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptances: [{ slug: "terms_of_service", versionId: pendingBody3[0].versionId }] }),
    });
    expect(accept2.status).toBe(200);

    const pending4 = await familyApp.request("/api/v1/me/tcs/pending");
    expect(await pending4.json()).toEqual([]);

    // The audit log kept both versions.
    expect(acceptances.map((acceptance) => acceptance.version).sort()).toEqual([1, 2]);
  });

  it("lets an admin manage documents end to end", async () => {
    const state = { documents: [] as Array<TcDocument>, versions: [] as Array<TcDocumentVersion> };
    const app = makeApp({ ...state, user: makeUser({ id: "admin-1", role: "admin" }) });

    const createRes = await app.request("/api/v1/admin/tcs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "privacy_policy", title: "Privacy Policy", appliesToRole: "all" }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const draftRes = await app.request(`/api/v1/admin/tcs/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Initial version", content: "# Privacy", checkboxLabel: "I acknowledge the policy." }),
    });
    expect(draftRes.status).toBe(200);

    const duplicateDraft = await app.request(`/api/v1/admin/tcs/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Second", content: "# Privacy 2", checkboxLabel: "Label" }),
    });
    expect(duplicateDraft.status).toBe(409);
    expect((await duplicateDraft.json()).error.code).toBe("TC_DRAFT_EXISTS");

    const editDraft = await app.request(`/api/v1/admin/tcs/${created.id}/draft`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "# Privacy, edited" }),
    });
    expect(editDraft.status).toBe(200);
    expect((await editDraft.json()).content).toBe("# Privacy, edited");

    const publishRes = await app.request(`/api/v1/admin/tcs/${created.id}/publish`, { method: "POST" });
    expect(publishRes.status).toBe(200);

    const detailRes = await app.request(`/api/v1/admin/tcs/${created.id}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]).toMatchObject({ version: 1, description: "Initial version" });

    const duplicateDoc = await app.request("/api/v1/admin/tcs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "privacy_policy", title: "Again", appliesToRole: "all" }),
    });
    expect(duplicateDoc.status).toBe(409);
    expect((await duplicateDoc.json()).error.code).toBe("TC_SLUG_TAKEN");
  });

  it("rejects admin mutations without the tcs write permission", async () => {
    const app = makeApp({ hasPermission: false });
    const res = await app.request("/api/v1/admin/tcs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "privacy_policy", title: "Privacy Policy", appliesToRole: "all" }),
    });
    expect(res.status).toBe(403);
  });

  it("never reports pending documents to admins", async () => {
    const doc = makeDoc({ id: "doc-1" });
    const app = makeApp({
      user: makeUser({ id: "admin-1", role: "admin" }),
      documents: [doc],
      versions: [makeVersion({ id: "v-1", documentId: "doc-1" })],
    });

    const res = await app.request("/api/v1/me/tcs/pending");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("requires a session for pending lookups", async () => {
    const app = makeApp({ authSession: null });
    const res = await app.request("/api/v1/me/tcs/pending");
    expect(res.status).toBe(401);
  });
});
