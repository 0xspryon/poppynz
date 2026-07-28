import { SqlError } from "@effect/sql/SqlError";
import {
  DBNotFoundError,
  makeSessionRepoTest,
  makeTcDocumentRepoTest,
  makeUserRepoTest,
  type Session,
  type TcAcceptanceInput,
  type TcDocument,
  type TcDocumentAcceptance,
  type TcDocumentVersion,
  type User,
} from "@repo/db";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { makeAuthServiceTest } from "@/api/lib/effect-auth";
import {
  acceptTcsRouteProgram,
  createTcDocumentRouteProgram,
  createTcDraftRouteProgram,
  listAdminTcsRouteProgram,
  listPendingTcsRouteProgram,
  listPublishedTcsRouteProgram,
  publishTcDraftRouteProgram,
  updateTcDraftRouteProgram,
} from "./tcs.handler";

const user = (overrides: Partial<User> = {}): User => ({
  id: "user-1", name: "Fam Ily", email: "family@example.com", emailVerified: true, image: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"), updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  isAnonymous: false, role: "family", banned: false, banReason: null, banExpires: null, phoneNumber: null, phoneNumberVerified: null,
  ...overrides,
});

const session = (): Session => ({
  id: "session-1", expiresAt: new Date("2026-07-02T00:00:00.000Z"), token: "token",
  createdAt: new Date("2026-07-01T00:00:00.000Z"), updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  ipAddress: null, userAgent: null, userId: "user-1", impersonatedBy: null, activeOrganizationId: null,
});

const doc = (overrides: Partial<TcDocument> = {}): TcDocument => ({
  id: "doc-1", slug: "terms_of_service", title: "Terms of Service", appliesToRole: "all",
  createdAt: new Date("2026-07-01T00:00:00.000Z"), updatedAt: new Date("2026-07-01T00:00:00.000Z"), deletedAt: null,
  ...overrides,
});

const version = (overrides: Partial<TcDocumentVersion> = {}): TcDocumentVersion => ({
  id: "version-1", documentId: "doc-1", version: 1, description: "Initial version",
  content: "# Terms", checkboxLabel: "I agree to the terms.",
  publishedAt: new Date("2026-07-01T00:00:00.000Z"),
  createdAt: new Date("2026-07-01T00:00:00.000Z"), updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  ...overrides,
});

const contextWithJson = (body: unknown) => ({ req: { json: async () => body } }) as HonoContext<HonoEnv>;

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: {
  documents?: Array<TcDocument>;
  versions?: Array<TcDocumentVersion>;
  acceptances?: Array<TcDocumentAcceptance>;
  currentUser?: User;
  hasPermission?: boolean;
  listError?: SqlError;
} = {}) => {
  const currentUser = options.currentUser ?? user();
  const currentSession = session();
  const documents = options.documents ?? [doc()];
  const versions = options.versions ?? [version()];
  const acceptances = options.acceptances ?? [];

  const activeDocuments = () => documents.filter((candidate) => candidate.deletedAt === null);
  const publishedForRole = (role: "family" | "service-provider" | "admin") =>
    activeDocuments()
      .filter((candidate) => candidate.appliesToRole === role || candidate.appliesToRole === "all")
      .flatMap((document) => {
        const latest = versions
          .filter((candidate) => candidate.documentId === document.id && candidate.publishedAt !== null)
          .sort((a, b) => b.version - a.version)[0];
        return latest ? [{ document, version: latest }] : [];
      });

  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: currentUser.id }, session: { id: currentSession.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true),
    }),
    makeUserRepoTest({
      findById: (id) => id === currentUser.id ? Effect.succeed(currentUser) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
      findByEmail: () => Effect.succeed(currentUser),
    }),
    makeSessionRepoTest({ findById: (id) => id === currentSession.id ? Effect.succeed(currentSession) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })) }),
    makeTcDocumentRepoTest({
      listActive: () => options.listError ? Effect.fail(options.listError) : Effect.succeed(activeDocuments()),
      findActiveById: (id) => {
        const found = activeDocuments().find((candidate) => candidate.id === id);
        return found ? Effect.succeed(found) : Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: id }));
      },
      findActiveBySlug: (slug) => {
        const found = activeDocuments().find((candidate) => candidate.slug === slug);
        return found ? Effect.succeed(found) : Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: slug }));
      },
      createDocument: (input) => {
        const created = doc({ ...input, id: "doc-new" });
        documents.push(created);
        return Effect.succeed(created);
      },
      updateDocument: (id, input) => {
        const found = activeDocuments().find((candidate) => candidate.id === id);
        if (!found) return Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: id }));
        Object.assign(found, input);
        return Effect.succeed(found);
      },
      softDeleteDocument: (id) => {
        const found = activeDocuments().find((candidate) => candidate.id === id);
        if (!found) return Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: id }));
        found.deletedAt = new Date("2026-07-02T00:00:00.000Z");
        return Effect.succeed(found);
      },
      listVersions: (documentId) =>
        Effect.succeed(
          versions
            .filter((candidate) => candidate.documentId === documentId)
            .sort((a, b) => b.version - a.version),
        ),
      listVersionsByDocumentIds: (documentIds) =>
        Effect.succeed(
          versions
            .filter((candidate) => documentIds.includes(candidate.documentId))
            .sort((a, b) => b.version - a.version),
        ),
      createDraft: (documentId, input) => {
        const document = activeDocuments().find((candidate) => candidate.id === documentId);
        if (!document) return Effect.fail(new DBNotFoundError({ entity: "tcDocument", value: documentId }));
        const latest = versions
          .filter((candidate) => candidate.documentId === documentId)
          .sort((a, b) => b.version - a.version)[0];
        const draft = version({
          ...input,
          id: `version-draft-${documentId}`,
          documentId,
          version: (latest?.version ?? 0) + 1,
          publishedAt: null,
        });
        versions.push(draft);
        return Effect.succeed(draft);
      },
      updateDraft: (documentId, input) => {
        const draft = versions.find((candidate) => candidate.documentId === documentId && candidate.publishedAt === null);
        if (!draft) return Effect.fail(new DBNotFoundError({ entity: "tcDocumentVersion", value: documentId }));
        Object.assign(draft, input);
        return Effect.succeed(draft);
      },
      publishDraft: (documentId) => {
        const draft = versions.find((candidate) => candidate.documentId === documentId && candidate.publishedAt === null);
        if (!draft) return Effect.fail(new DBNotFoundError({ entity: "tcDocumentVersion", value: documentId }));
        draft.publishedAt = new Date("2026-07-03T00:00:00.000Z");
        return Effect.succeed(draft);
      },
      findLatestPublished: (documentId) => {
        const latest = versions
          .filter((candidate) => candidate.documentId === documentId && candidate.publishedAt !== null)
          .sort((a, b) => b.version - a.version)[0];
        return latest
          ? Effect.succeed(latest)
          : Effect.fail(new DBNotFoundError({ entity: "tcDocumentVersion", value: documentId }));
      },
      listPublishedForRole: (role) => Effect.succeed(publishedForRole(role)),
      listPendingForUser: (userId, role) =>
        Effect.succeed(
          publishedForRole(role).filter(
            (entry) =>
              !acceptances.some(
                (acceptance) => acceptance.userId === userId && acceptance.versionId === entry.version.id,
              ),
          ),
        ),
      listAcceptancesForUser: (userId) =>
        Effect.succeed(acceptances.filter((candidate) => candidate.userId === userId)),
      insertAcceptances: (userId, items: Array<TcAcceptanceInput>) => {
        const inserted = items
          .filter((item) => !acceptances.some((existing) => existing.userId === userId && existing.versionId === item.versionId))
          .map((item, index) => ({
            ...item,
            id: `acceptance-${acceptances.length + index}`,
            userId,
            acceptedAt: new Date("2026-07-01T12:00:00.000Z"),
          }));
        acceptances.push(...inserted);
        return Effect.succeed(inserted);
      },
    }),
  );
};

describe("tcs route programs", () => {
  it("lists published documents for a role, including all-audience documents", async () => {
    const documents = [
      doc(),
      doc({ id: "doc-sp", slug: "service_provider_fee_acceptance", appliesToRole: "service-provider" }),
      doc({ id: "doc-family", slug: "family_fee_acceptance", appliesToRole: "family" }),
    ];
    const versions = [
      version(),
      version({ id: "version-sp", documentId: "doc-sp" }),
      version({ id: "version-family", documentId: "doc-family" }),
    ];
    const result = await Effect.runPromise(
      listPublishedTcsRouteProgram("service-provider").pipe(Effect.provide(makeLayer({ documents, versions }))),
    );
    expect(result.map((entry) => entry.slug)).toEqual(["terms_of_service", "service_provider_fee_acceptance"]);
    expect(result[0]).toMatchObject({ versionId: "version-1", version: 1, checkboxLabel: "I agree to the terms." });
  });

  it("rejects an unknown role param", async () => {
    const exit = await Effect.runPromise(
      listPublishedTcsRouteProgram("superuser").pipe(Effect.provide(makeLayer()), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("RequestValidationError");
  });

  it("rejects admin as a role param — admins are not a T&C audience", async () => {
    const exit = await Effect.runPromise(
      listPublishedTcsRouteProgram("admin").pipe(Effect.provide(makeLayer()), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("RequestValidationError");
  });

  it("excludes unpublished documents from the published list", async () => {
    const versions = [version({ publishedAt: null })];
    const result = await Effect.runPromise(
      listPublishedTcsRouteProgram("family").pipe(Effect.provide(makeLayer({ versions }))),
    );
    expect(result).toEqual([]);
  });

  it("lists pending documents for the current user's role", async () => {
    const result = await Effect.runPromise(
      listPendingTcsRouteProgram(new Headers()).pipe(Effect.provide(makeLayer())),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ slug: "terms_of_service", versionId: "version-1" });
  });

  it("returns no pending documents once the latest version is accepted", async () => {
    const acceptances: Array<TcDocumentAcceptance> = [{
      id: "acceptance-0", userId: "user-1", documentId: "doc-1", slug: "terms_of_service",
      versionId: "version-1", version: 1, acceptedAt: new Date("2026-07-01T12:00:00.000Z"),
    }];
    const result = await Effect.runPromise(
      listPendingTcsRouteProgram(new Headers()).pipe(Effect.provide(makeLayer({ acceptances }))),
    );
    expect(result).toEqual([]);
  });

  it("returns no pending documents for admins", async () => {
    const result = await Effect.runPromise(
      listPendingTcsRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ currentUser: user({ role: "admin" }) })),
      ),
    );
    expect(result).toEqual([]);
  });

  it("rejects pending lookups without the tcs permission", async () => {
    const exit = await Effect.runPromise(
      listPendingTcsRouteProgram(new Headers()).pipe(Effect.provide(makeLayer({ hasPermission: false })), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("ForbiddenError");
  });

  it("records an acceptance with the denormalized slug and version", async () => {
    const acceptances: Array<TcDocumentAcceptance> = [];
    const result = await Effect.runPromise(
      acceptTcsRouteProgram(
        contextWithJson({ acceptances: [{ slug: "terms_of_service", versionId: "version-1" }] }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ acceptances }))),
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toMatchObject({
      userId: "user-1", documentId: "doc-1", slug: "terms_of_service", versionId: "version-1", version: 1,
    });
    expect(acceptances).toHaveLength(1);
  });

  it("fails with TcVersionStaleError when accepting an outdated version", async () => {
    const versions = [version(), version({ id: "version-2", version: 2 })];
    const exit = await Effect.runPromise(
      acceptTcsRouteProgram(
        contextWithJson({ acceptances: [{ slug: "terms_of_service", versionId: "version-1" }] }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ versions })), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("TcVersionStaleError");
  });

  it("fails with TcDocumentNotFoundError for an unknown slug", async () => {
    const exit = await Effect.runPromise(
      acceptTcsRouteProgram(
        contextWithJson({ acceptances: [{ slug: "missing", versionId: "version-1" }] }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer()), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("TcDocumentNotFoundError");
  });

  it("rejects an empty acceptance list", async () => {
    const exit = await Effect.runPromise(
      acceptTcsRouteProgram(contextWithJson({ acceptances: [] }), new Headers()).pipe(
        Effect.provide(makeLayer()),
        Effect.exit,
      ),
    );
    expect(getFailure(exit)._tag).toBe("RequestValidationError");
  });

  it("lists documents with their version history for admins", async () => {
    const versions = [version(), version({ id: "version-2", version: 2, publishedAt: null, description: "WIP" })];
    const result = await Effect.runPromise(
      listAdminTcsRouteProgram(new Headers()).pipe(Effect.provide(makeLayer({ versions }))),
    );
    expect(result).toHaveLength(1);
    expect(result[0].versions.map((entry) => entry.version)).toEqual([2, 1]);
    expect(result[0].versions[0]).toMatchObject({ description: "WIP", publishedAt: null });
  });

  it("creates a document and rejects duplicate slugs", async () => {
    const documents = [doc()];
    const created = await Effect.runPromise(
      createTcDocumentRouteProgram(
        contextWithJson({ slug: "privacy_policy", title: "Privacy Policy", appliesToRole: "all" }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ documents }))),
    );
    expect(created).toMatchObject({ slug: "privacy_policy", title: "Privacy Policy" });

    const exit = await Effect.runPromise(
      createTcDocumentRouteProgram(
        contextWithJson({ slug: "terms_of_service", title: "Duplicate", appliesToRole: "all" }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ documents })), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("TcSlugTakenError");
  });

  it("creates a draft with the next version number", async () => {
    const versions = [version()];
    const result = await Effect.runPromise(
      createTcDraftRouteProgram(
        contextWithJson({ description: "Fee update", content: "# Terms v2", checkboxLabel: "I agree." }),
        new Headers(),
        "doc-1",
      ).pipe(Effect.provide(makeLayer({ versions }))),
    );
    expect(result).toMatchObject({ version: 2, publishedAt: null, description: "Fee update" });
  });

  it("refuses a second open draft", async () => {
    const versions = [version(), version({ id: "version-2", version: 2, publishedAt: null })];
    const exit = await Effect.runPromise(
      createTcDraftRouteProgram(
        contextWithJson({ description: "Another", content: "# v3", checkboxLabel: "I agree." }),
        new Headers(),
        "doc-1",
      ).pipe(Effect.provide(makeLayer({ versions })), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("TcDraftExistsError");
  });

  it("updates the open draft only", async () => {
    const versions = [version(), version({ id: "version-2", version: 2, publishedAt: null })];
    const result = await Effect.runPromise(
      updateTcDraftRouteProgram(contextWithJson({ content: "# Edited" }), new Headers(), "doc-1").pipe(
        Effect.provide(makeLayer({ versions })),
      ),
    );
    expect(result).toMatchObject({ id: "version-2", content: "# Edited" });
  });

  it("maps a missing draft to TcDraftNotFoundError on publish", async () => {
    const exit = await Effect.runPromise(
      publishTcDraftRouteProgram(new Headers(), "doc-1").pipe(Effect.provide(makeLayer()), Effect.exit),
    );
    expect(getFailure(exit)._tag).toBe("TcDraftNotFoundError");
  });

  it("publishes the open draft", async () => {
    const versions = [version(), version({ id: "version-2", version: 2, publishedAt: null })];
    const result = await Effect.runPromise(
      publishTcDraftRouteProgram(new Headers(), "doc-1").pipe(Effect.provide(makeLayer({ versions }))),
    );
    expect(result).toMatchObject({ id: "version-2", version: 2, publishedAt: "2026-07-03T00:00:00.000Z" });
  });

  it("maps SqlError to TcRepoError on the admin list", async () => {
    const exit = await Effect.runPromise(
      listAdminTcsRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ listError: new SqlError({ cause: new Error("boom"), message: "boom" }) })),
        Effect.exit,
      ),
    );
    expect(getFailure(exit)._tag).toBe("TcRepoError");
  });
});
