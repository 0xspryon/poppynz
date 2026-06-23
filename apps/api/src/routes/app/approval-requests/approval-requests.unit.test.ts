import { SqlError } from "@effect/sql/SqlError";
import {
  DBNotFoundError,
  makeApprovalRequestRepoTest,
  makeKycDocumentRepoTest,
  makeKycDocumentTypeRepoTest,
  makeServiceOfferedRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type ApprovalRequest,
  type KycDocument,
  type KycDocumentType,
  type ServiceOffered,
  type Session,
  type User,
} from "@repo/db";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { makeAuthServiceTest } from "@/api/lib/effect-auth";
import { createApprovalRequestRouteProgram } from "./approval-requests.handler";

const user = (overrides: Partial<User> = {}): User => ({
  id: "provider-1",
  name: "Provider User",
  email: "provider@example.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  isAnonymous: false,
  role: "service-provider",
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides,
});

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  expiresAt: new Date("2026-06-13T00:00:00.000Z"),
  token: "session-token",
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ipAddress: null,
  userAgent: null,
  userId: "provider-1",
  impersonatedBy: null,
  activeOrganizationId: null,
  ...overrides,
});

const approvalRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: "request-1",
  userId: "provider-1",
  status: "submitted",
  reviewedBy: null,
  reviewedAt: null,
  reason: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const documentType = (overrides: Partial<KycDocumentType> = {}): KycDocumentType => ({
  id: "document-type-1",
  name: "Identity document",
  appliesToRole: "service-provider",
  isOptional: false,
  requiresExpiryDate: true,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

const kycDocument = (overrides: Partial<KycDocument> = {}): KycDocument => ({
  id: "kyc-document-1",
  userId: "provider-1",
  documentTypeId: "document-type-1",
  filename: "identity.pdf",
  fileKey: "users/provider-1/kyc/document-type-1/identity.pdf",
  status: "submitted",
  reason: null,
  expiryDate: new Date("2027-06-12T00:00:00.000Z"),
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

const serviceOffered = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  id: "service-1",
  userId: "provider-1",
  name: "Childcare",
  description: null,
  hourlyRateCents: 2500,
  currency: "CAD",
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: {
  user?: User;
  existingSubmitted?: ApprovalRequest | null;
  createSubmittedError?: SqlError;
  documentTypes?: Array<KycDocumentType>;
  documents?: Array<KycDocument>;
  services?: Array<ServiceOffered>;
  onCreateSubmitted?: (userId: string) => void;
} = {}) => {
  const currentUser = options.user ?? user();
  const currentSession = session({ userId: currentUser.id });

  return Layer.mergeAll(
    makeApprovalRequestRepoTest({
      createSubmitted: (userId) => {
        options.onCreateSubmitted?.(userId);
        return options.createSubmittedError
          ? Effect.fail(options.createSubmittedError)
          : Effect.succeed(approvalRequest({ id: "request-created", userId }));
      },
      list: () => Effect.succeed([]),
      findById: (id) => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id })),
      findSubmittedByUserId: (userId) =>
        options.existingSubmitted === null || options.existingSubmitted === undefined
          ? Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: userId }))
          : Effect.succeed(options.existingSubmitted),
      findLatestByUserId: (userId) => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: userId })),
      markApproved: (id) => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id })),
      reject: (id) => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id })),
    }),
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed(options.documentTypes ?? [documentType()]),
      findActiveById: (id) => Effect.fail(new DBNotFoundError({ entity: "kycDocumentType", value: id })),
      create: () => Effect.fail(new SqlError({ message: "not used" })),
      update: (id) => Effect.fail(new DBNotFoundError({ entity: "kycDocumentType", value: id })),
      softDelete: (id) => Effect.fail(new DBNotFoundError({ entity: "kycDocumentType", value: id })),
    }),
    makeKycDocumentRepoTest({
      findByIdWithType: (id) => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: id })),
      findByUserId: () => Effect.succeed(options.documents ?? [kycDocument()]),
      findByUserIdWithTypes: () => Effect.succeed([]),
      submit: () => Effect.fail(new SqlError({ message: "not used" })),
      updateExpiryDate: (id) => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: id })),
      approveSubmittedByUserId: () => Effect.succeed([]),
    }),
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.services ?? [serviceOffered()]),
      create: () => Effect.fail(new SqlError({ message: "not used" })),
      updateByIdForUser: (id) => Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: id })),
      softDeleteByIdForUser: (id) => Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: id })),
    }),
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: currentUser.id }, session: { id: currentSession.id } }),
      userHasPermission: () => Effect.succeed(true),
    }),
    makeUserRepoTest({
      findById: (id) => id === currentUser.id ? Effect.succeed(currentUser) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
      findByEmail: () => Effect.succeed(currentUser),
    }),
    makeSessionRepoTest({
      findById: (id) => id === currentSession.id ? Effect.succeed(currentSession) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
    }),
  );
};

describe("createApprovalRequestRouteProgram", () => {
  it("creates a submitted approval request with no warnings when onboarding data is complete", async () => {
    const createdFor: Array<string> = [];

    const result = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ onCreateSubmitted: (userId) => createdFor.push(userId) })),
      ),
    );

    expect(result).toEqual({
      id: "request-created",
      status: "submitted",
      warnings: {
        missingRequiredDocuments: [],
        missingServicesOffered: false,
      },
    });
    expect(createdFor).toEqual(["provider-1"]);
  });

  it("returns warnings for missing required documents and services", async () => {
    const result = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ documents: [], services: [] })),
      ),
    );

    expect(result.warnings).toEqual({
      missingRequiredDocuments: [{ documentTypeId: "document-type-1", name: "Identity document" }],
      missingServicesOffered: true,
    });
  });

  it("fails when a submitted approval request already exists", async () => {
    const exit = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ existingSubmitted: approvalRequest() })),
        Effect.exit,
      ),
    );

    expect(getFailure(exit)._tag).toBe("ApprovalRequestAlreadySubmittedError");
  });

  it("fails when the authenticated user is not a service provider", async () => {
    const exit = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ user: user({ role: "family" }) })),
        Effect.exit,
      ),
    );

    expect(getFailure(exit)._tag).toBe("ApprovalRequestValidationError");
  });

  it("propagates approval request repo SQL failures", async () => {
    const exit = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ createSubmittedError: new SqlError({ message: "db down" }) })),
        Effect.exit,
      ),
    );

    expect(getFailure(exit)).toBeInstanceOf(SqlError);
  });
});
