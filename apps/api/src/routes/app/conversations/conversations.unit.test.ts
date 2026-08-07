import { SqlError } from "@effect/sql/SqlError";
import {
  dummyConversation,
  dummyConversationMessage,
  dummyConversationWithContext,
  dummyContract,
  dummyContractVersion,
  makeApprovalRepoTest,
  makeContractRepoTest,
  makeConversationRepoTest,
  makeServiceNeededRepoTest,
  makeServiceOfferedRepoTest,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  DBNotFoundError,
  type Approval,
  type Contract,
  type ContractVersion,
  type Conversation,
  type ConversationWithContext,
  type SafeUserProfile,
  type ServiceNeeded,
  type ServiceOffered,
  type Session,
  type User,
} from "@repo/db";
import { makeNotificationHubTest, type NotificationInput } from "@repo/notify";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { makeAuthServiceTest } from "@/api/lib/effect-auth";
import {
  createReachoutRouteProgram,
  getConversationRouteProgram,
  ignoreReachoutRouteProgram,
  listConversationsRouteProgram,
  lookupConversationRouteProgram,
  respondToReachoutRouteProgram,
  sendMessageRouteProgram,
  unreadCountRouteProgram,
} from "./conversations.handler";

const CONVERSATION_ID = "0198a3b0-0000-7000-8000-000000000001";
const OLD_IGNORED_AT = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
const RECENT_IGNORED_AT = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

const familyUser = (overrides: Partial<User> = {}): User => ({
  id: "family-1", name: "Priya K", email: "priya@example.com", emailVerified: true, image: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"), updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  isAnonymous: false, role: "family", banned: false, banReason: null, banExpires: null, phoneNumber: null, phoneNumberVerified: null,
  ...overrides,
});

const providerUser = (overrides: Partial<User> = {}): User =>
  familyUser({ id: "provider-1", name: "Maria S", email: "maria@example.com", role: "service-provider", ...overrides });

const session = (userId: string): Session => ({
  id: "session-1", expiresAt: new Date("2026-06-13T00:00:00.000Z"), token: "token",
  createdAt: new Date("2026-06-12T00:00:00.000Z"), updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ipAddress: null, userAgent: null, userId, impersonatedBy: null, activeOrganizationId: null,
});

const profile = (userId: string, firstName: string, city: string | null): SafeUserProfile => ({
  userId, email: `${firstName.toLowerCase()}@example.com`, role: userId === "family-1" ? "family" : "service-provider",
  language: "en", firstName, lastName: "Tester", gender: null, phoneNumber: null, dateOfBirth: null,
  address: null, city, postalCode: null, country: null, stateProvince: null, shortBio: null,
  googlePlaceId: null, latitude: null, longitude: null,
});

const offeredService = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  id: "11111111-1111-4111-8111-111111111111", userId: "provider-1", catalogueServiceId: null,
  name: "Childcare", description: null, hourlyRateCents: 2500, currency: "CAD",
  deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const neededService = (overrides: Partial<ServiceNeeded> = {}): ServiceNeeded => ({
  id: "22222222-2222-4222-8222-222222222222", userId: "family-1", catalogueServiceId: null,
  name: "School pickup", description: null,
  deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const currentApproval = (userId: string): Approval => ({
  id: "00000000-0000-7000-8000-000000000001",
  userId,
  approvalRequestId: "00000000-0000-7000-8000-000000000002",
  approvedBy: "admin-1",
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  status: "approved",
  reason: null,
  notifiedExpiresInOneMonthAt: null,
  notifiedExpiresInTwoWeeksAt: null,
  notifiedExpiresInOneWeekAt: null,
  notifiedExpiresInTwoDaysAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
});

const makeContext = (options: { body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}) =>
  ({
    req: {
      json: async () => options.body,
      param: (key: string) => options.params?.[key],
      query: (key: string) => options.query?.[key],
    },
    get: () => "en",
  }) as unknown as HonoContext<HonoEnv>;

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

type Published = { userId: string; input: NotificationInput };

const makeLayer = (options: {
  viewer?: User;
  counterpart?: User | null;
  hasPermission?: boolean;
  /** Whether the provider side holds a live approval (default true). */
  providerApproved?: boolean;
  /** When set, ConversationRepo.create fails with this SqlError. */
  createFailsWith?: SqlError;
  /** Per-call findByPair results (consumed in order); falls back to existingConversation. */
  findByPairResults?: Array<Conversation | null>;
  existingConversation?: Conversation | null;
  conversationById?: Conversation | null;
  conversationWithContext?: ConversationWithContext | null;
  conversations?: Array<ConversationWithContext>;
  offered?: Array<ServiceOffered>;
  needed?: Array<ServiceNeeded>;
  markRespondedResult?: Conversation | null;
  markIgnoredResult?: Conversation | null;
  contractByConversation?: Contract | null;
  contractVersions?: Array<ContractVersion>;
  published?: Array<Published>;
  onCreate?: (input: unknown) => void;
  onSoftDelete?: (id: string) => void;
  onMarkRead?: (id: string, side: string, at: Date) => void;
} = {}) => {
  const viewer = options.viewer ?? familyUser();
  const counterpart = options.counterpart === undefined ? providerUser() : options.counterpart;
  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: viewer.id }, session: { id: "session-1" } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true),
    }),
    makeUserRepoTest({
      findById: (id) => {
        if (id === viewer.id) return Effect.succeed(viewer);
        if (counterpart && id === counterpart.id) return Effect.succeed(counterpart);
        return Effect.fail(new DBNotFoundError({ entity: "user", value: id }));
      },
      findByEmail: () => Effect.die("not used"),
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session(viewer.id)) }),
    makeUserProfileRepoTest({
      create: () => Effect.die("not used"),
      findByUserId: (userId) =>
        Effect.succeed(
          userId === "family-1" ? profile("family-1", "Priya", "Little Italy, Toronto") : profile("provider-1", "Maria", "Toronto"),
        ),
      updateByUserId: () => Effect.die("not used"),
      updateLocationByUserId: () => Effect.die("not used"),
    }),
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.offered ?? [offeredService()]),
      findByIdForUser: () => Effect.die("not used"),
      create: () => Effect.die("not used"),
      updateByIdForUser: () => Effect.die("not used"),
      softDeleteByIdForUser: () => Effect.die("not used"),
    }),
    makeServiceNeededRepoTest({
      listByUserId: () => Effect.succeed(options.needed ?? [neededService()]),
      findByIdForUser: () => Effect.die("not used"),
      create: () => Effect.die("not used"),
      updateByIdForUser: () => Effect.die("not used"),
      softDeleteByIdForUser: () => Effect.die("not used"),
    }),
    makeApprovalRepoTest({
      findCurrentByUserId: (userId) =>
        (options.providerApproved ?? true)
          ? Effect.succeed(currentApproval(userId))
          : Effect.fail(new DBNotFoundError({ entity: "approval", value: userId })),
    }),
    makeConversationRepoTest({
      create: (input) => {
        options.onCreate?.(input);
        if (options.createFailsWith) return Effect.fail(options.createFailsWith);
        return Effect.succeed({ ...dummyConversation, id: CONVERSATION_ID, ...input });
      },
      findByPair: () =>
        Effect.succeed(
          options.findByPairResults && options.findByPairResults.length > 0
            ? (options.findByPairResults.shift() ?? null)
            : (options.existingConversation ?? null),
        ),
      findById: () => Effect.succeed(options.conversationById ?? null),
      findWithContext: () => Effect.succeed(options.conversationWithContext ?? null),
      listForUser: () => Effect.succeed(options.conversations ?? []),
      listMessages: () => Effect.succeed([dummyConversationMessage]),
      createMessage: (input) =>
        Effect.succeed({ ...dummyConversationMessage, id: "message-2", conversationId: input.conversationId, senderUserId: input.senderUserId, body: input.body }),
      markResponded: () => Effect.succeed(options.markRespondedResult ?? null),
      markIgnored: () => Effect.succeed(options.markIgnoredResult ?? null),
      markRead: (id, side, at) => {
        options.onMarkRead?.(id, side, at);
        return Effect.void;
      },
      softDeleteById: (id) => {
        options.onSoftDelete?.(id);
        return Effect.void;
      },
    }),
    makeContractRepoTest({
      create: () => Effect.die("not used"),
      findById: () => Effect.succeed(null),
      findByConversationId: () => Effect.succeed(options.contractByConversation ?? null),
      findWithContext: () => Effect.succeed(null),
      listForUser: () => Effect.succeed([]),
      listVersions: () => Effect.succeed(options.contractVersions ?? []),
      createVersion: () => Effect.die("not used"),
      updateVersionTerms: () => Effect.die("not used"),
      sendPendingVersion: () => Effect.die("not used"),
      withdrawPendingVersion: () => Effect.die("not used"),
      withdrawAmendment: () => Effect.die("not used"),
      acceptPendingVersion: () => Effect.die("not used"),
      decidePendingVersion: () => Effect.die("not used"),
      setEnding: () => Effect.die("not used"),
      markSeen: () => Effect.die("not used"),
    }),
    makeNotificationHubTest({
      publish: (userId, input) => {
        options.published?.push({ userId, input });
        return Effect.void;
      },
      subscribe: () => Effect.die("not used"),
    }),
  );
};

const activeConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  ...dummyConversation,
  id: CONVERSATION_ID,
  status: "active",
  respondedAt: new Date("2026-08-02T00:00:00.000Z"),
  ...overrides,
});

describe("POST /conversations (reach-out)", () => {
  it("creates a reach-out with the rendered template and service snapshot, then notifies the recipient", async () => {
    const created: Array<any> = [];
    const published: Array<Published> = [];
    const layer = makeLayer({ onCreate: (input) => created.push(input), published });

    const result = await Effect.runPromise(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "provider-1", serviceIds: [offeredService().id] } }),
        new Headers(),
      ).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ id: CONVERSATION_ID });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      familyUserId: "family-1",
      providerUserId: "provider-1",
      initiatorUserId: "family-1",
      reachoutServices: [{ serviceId: offeredService().id, name: "Childcare" }],
    });
    expect(created[0].reachoutMessage).toBe(
      "Hi Maria — I'd like to work with you. We're in Little Italy, Toronto. Take a look at my family profile and the services we need below.",
    );
    expect(published).toEqual([
      {
        userId: "provider-1",
        input: {
          type: "conversation.reachout",
          payload: { conversationId: CONVERSATION_ID, senderName: "Priya Tester" },
        },
      },
    ]);
  });

  it("lets a provider reach out to a family using the family's needs", async () => {
    const created: Array<any> = [];
    const layer = makeLayer({
      viewer: providerUser(),
      counterpart: familyUser(),
      onCreate: (input) => created.push(input),
      published: [],
    });

    await Effect.runPromise(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "family-1", serviceIds: [neededService().id] } }),
        new Headers(),
      ).pipe(Effect.provide(layer)),
    );

    expect(created[0]).toMatchObject({
      familyUserId: "family-1",
      providerUserId: "provider-1",
      initiatorUserId: "provider-1",
      reachoutServices: [{ serviceId: neededService().id, name: "School pickup" }],
    });
  });

  it("fails when the recipient does not exist", async () => {
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "ghost", serviceIds: [offeredService().id] } }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer())),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "RecipientNotFoundError" });
  });

  it("fails when the two users are not a family/provider pair", async () => {
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "family-2", serviceIds: [offeredService().id] } }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ counterpart: familyUser({ id: "family-2" }) }))),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ConversationPairInvalidError" });
  });

  it("fails with the existing conversation when the pair already talks", async () => {
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "provider-1", serviceIds: [offeredService().id] } }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ existingConversation: activeConversation() }))),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ConversationExistsError", conversationId: CONVERSATION_ID });
  });

  it("stays vague when the sender is the one who ignored within the cool-down", async () => {
    // Viewer is the provider who ignored the family's reach-out 5 days ago.
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "family-1", serviceIds: [neededService().id] } }),
        new Headers(),
      ).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            counterpart: familyUser(),
            existingConversation: activeConversation({ status: "ignored", ignoredAt: RECENT_IGNORED_AT, initiatorUserId: "family-1" }),
          }),
        ),
      ),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ReachoutUnavailableError" });
  });

  it("archives an expired ignored conversation and starts the pair over", async () => {
    const softDeleted: Array<string> = [];
    const created: Array<any> = [];
    const layer = makeLayer({
      existingConversation: activeConversation({ status: "ignored", ignoredAt: OLD_IGNORED_AT, initiatorUserId: "family-1" }),
      onSoftDelete: (id) => softDeleted.push(id),
      onCreate: (input) => created.push(input),
      published: [],
    });

    const result = await Effect.runPromise(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "provider-1", serviceIds: [offeredService().id] } }),
        new Headers(),
      ).pipe(Effect.provide(layer)),
    );

    expect(softDeleted).toEqual([CONVERSATION_ID]);
    expect(created).toHaveLength(1);
    expect(result).toEqual({ id: CONVERSATION_ID });
  });

  it("rejects services outside the counterpart's current list", async () => {
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({
          body: { recipientUserId: "provider-1", serviceIds: ["33333333-3333-4333-8333-333333333333"] },
        }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer())),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "InvalidReachoutServicesError" });
  });

  it("maps a lost unique-index race to CONVERSATION_EXISTS with the winner's id", async () => {
    const uniqueViolation = new SqlError({
      cause: { code: "23505", constraint: "conversations_family_provider_uidx" },
    });
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "provider-1", serviceIds: [offeredService().id] } }),
        new Headers(),
      ).pipe(
        Effect.provide(
          makeLayer({
            createFailsWith: uniqueViolation,
            // First check sees no conversation; the post-conflict re-check
            // finds the concurrent winner.
            findByPairResults: [null, activeConversation()],
          }),
        ),
      ),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ConversationExistsError", conversationId: CONVERSATION_ID });
  });

  it("blocks providers without a live approval from initiating reach-outs", async () => {
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "family-1", serviceIds: [neededService().id] } }),
        new Headers(),
      ).pipe(
        Effect.provide(
          makeLayer({ viewer: providerUser(), counterpart: familyUser(), providerApproved: false }),
        ),
      ),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ProviderNotApprovedError" });
  });

  it("rejects invalid payloads before touching auth or repos", async () => {
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: "provider-1", serviceIds: [] } }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer())),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "RequestValidationError", code: "INVALID_REACHOUT_INPUT" });
  });
});

describe("GET /conversations", () => {
  it("presents an ignored thread as pending to its initiator and counts unread", async () => {
    const layer = makeLayer({
      conversations: [
        { ...dummyConversationWithContext, id: "c-1", status: "ignored", initiatorUserId: "family-1", unreadCount: 0 },
        { ...dummyConversationWithContext, id: "c-2", status: "active", unreadCount: 3 },
        { ...dummyConversationWithContext, id: "c-3", status: "pending", initiatorUserId: "provider-1", unreadCount: 0 },
      ],
    });

    const result = await Effect.runPromise(
      listConversationsRouteProgram(new Headers()).pipe(Effect.provide(layer)),
    );

    expect(result.conversations.map((entry) => [entry.id, entry.status, entry.awaitingMyResponse])).toEqual([
      ["c-1", "pending", false],
      ["c-2", "active", false],
      ["c-3", "pending", true],
    ]);
    // c-2 has unread messages, c-3 is an unanswered reach-out for the viewer.
    expect(result.unreadTotal).toBe(2);
  });

  it("fails with ForbiddenError when the conversation read permission is missing", async () => {
    const exit = await Effect.runPromiseExit(
      listConversationsRouteProgram(new Headers()).pipe(Effect.provide(makeLayer({ hasPermission: false }))),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ForbiddenError" });
  });

  it("reports the unread total on the badge endpoint", async () => {
    const layer = makeLayer({
      conversations: [{ ...dummyConversationWithContext, status: "pending", initiatorUserId: "provider-1" }],
    });
    const result = await Effect.runPromise(unreadCountRouteProgram(new Headers()).pipe(Effect.provide(layer)));
    expect(result).toEqual({ total: 1 });
  });
});

describe("GET /conversations/lookup", () => {
  it("returns null when the ignore cool-down has lapsed", async () => {
    const layer = makeLayer({
      existingConversation: activeConversation({ status: "ignored", ignoredAt: OLD_IGNORED_AT }),
    });
    const result = await Effect.runPromise(
      lookupConversationRouteProgram(makeContext({ query: { userId: "provider-1" } }), new Headers()).pipe(
        Effect.provide(layer),
      ),
    );
    expect(result).toEqual({ conversation: null });
  });

  it("routes the ignorer back to the thread as an answerable reach-out within the cool-down", async () => {
    const layer = makeLayer({
      viewer: providerUser(),
      counterpart: familyUser(),
      existingConversation: activeConversation({ status: "ignored", ignoredAt: RECENT_IGNORED_AT, initiatorUserId: "family-1" }),
    });
    const result = await Effect.runPromise(
      lookupConversationRouteProgram(makeContext({ query: { userId: "family-1" } }), new Headers()).pipe(
        Effect.provide(layer),
      ),
    );
    expect(result.conversation).toEqual({
      id: CONVERSATION_ID,
      status: "pending",
      isInitiator: false,
      awaitingMyResponse: true,
    });
  });
});

describe("GET /conversations/:id", () => {
  it("returns the conversation with its messages", async () => {
    const layer = makeLayer({
      conversationWithContext: { ...dummyConversationWithContext, id: CONVERSATION_ID, status: "active" },
    });
    const result = await Effect.runPromise(
      getConversationRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(layer),
      ),
    );
    expect(result.conversation.id).toBe(CONVERSATION_ID);
    expect(result.messages).toEqual([
      { id: "message-1", body: "Hi Priya! Thanks for reaching out.", at: "2026-08-01T09:32:00.000Z", sentByMe: false },
    ]);
  });

  it("fails with ConversationNotFoundError for threads the viewer cannot see", async () => {
    const exit = await Effect.runPromiseExit(
      getConversationRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(makeLayer({ conversationWithContext: null })),
      ),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ConversationNotFoundError" });
  });

  it("includes the conversation's contract summary for the chat pill", async () => {
    const layer = makeLayer({
      conversationWithContext: { ...dummyConversationWithContext, id: CONVERSATION_ID, status: "active" },
      contractByConversation: { ...dummyContract, conversationId: CONVERSATION_ID, status: "proposed" },
      contractVersions: [
        { ...dummyContractVersion, status: "proposed", sentAt: new Date() },
      ],
    });
    const result = await Effect.runPromise(
      getConversationRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(layer),
      ),
    );
    expect(result.contract).toMatchObject({
      id: dummyContract.id,
      status: "proposed",
      awaitingYou: false,
      pendingAmendment: false,
    });
  });

  it("hides a family-private draft contract from the provider's thread payload", async () => {
    const layer = makeLayer({
      viewer: providerUser(),
      counterpart: familyUser(),
      conversationWithContext: { ...dummyConversationWithContext, id: CONVERSATION_ID, status: "active", counterpartUserId: "family-1" },
      contractByConversation: { ...dummyContract, conversationId: CONVERSATION_ID, status: "draft" },
      contractVersions: [dummyContractVersion],
    });
    const result = await Effect.runPromise(
      getConversationRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(layer),
      ),
    );
    expect(result.contract).toBeNull();
  });

  it("flags a proposal awaiting the provider and keeps a revision draft out of their summary", async () => {
    const layer = makeLayer({
      viewer: providerUser(),
      counterpart: familyUser(),
      conversationWithContext: { ...dummyConversationWithContext, id: CONVERSATION_ID, status: "active", counterpartUserId: "family-1" },
      contractByConversation: { ...dummyContract, conversationId: CONVERSATION_ID, status: "declined" },
      contractVersions: [
        // Declined v1 is the provider-visible truth…
        { ...dummyContractVersion, id: "version-1", version: 1, status: "declined", decidedAt: new Date() },
        // …the family's unsent v2 draft must not shape the provider's pill.
        {
          ...dummyContractVersion,
          id: "version-2",
          version: 2,
          status: "draft",
          services: [{ ...dummyContractVersion.services[0], rateCents: 9900, hoursPerWeek: 40 }],
        },
      ],
    });
    const result = await Effect.runPromise(
      getConversationRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(layer),
      ),
    );
    // 2600 × 4 from the declined v1 — not 9900 × 40 from the private draft.
    expect(result.contract).toMatchObject({ status: "declined", weeklyEstimateCents: 10400 });

    const awaiting = makeLayer({
      viewer: providerUser(),
      counterpart: familyUser(),
      conversationWithContext: { ...dummyConversationWithContext, id: CONVERSATION_ID, status: "active", counterpartUserId: "family-1" },
      contractByConversation: { ...dummyContract, conversationId: CONVERSATION_ID, status: "proposed" },
      contractVersions: [{ ...dummyContractVersion, status: "proposed", sentAt: new Date() }],
    });
    const awaitingResult = await Effect.runPromise(
      getConversationRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(awaiting),
      ),
    );
    expect(awaitingResult.contract).toMatchObject({ status: "proposed", awaitingYou: true });
  });
});

describe("POST /conversations/:id/respond & /ignore", () => {
  it("unlocks the conversation and notifies the initiator", async () => {
    const published: Array<Published> = [];
    const responded = activeConversation();
    const layer = makeLayer({
      viewer: providerUser(),
      counterpart: familyUser(),
      conversationById: activeConversation({ status: "pending", respondedAt: null, initiatorUserId: "family-1" }),
      markRespondedResult: responded,
      published,
    });

    const result = await Effect.runPromise(
      respondToReachoutRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(layer),
      ),
    );

    expect(result).toEqual({ id: CONVERSATION_ID, status: "active", respondedAt: responded.respondedAt?.toISOString() });
    expect(published).toEqual([
      {
        userId: "family-1",
        input: {
          type: "conversation.unlocked",
          payload: { conversationId: CONVERSATION_ID, responderName: "Maria Tester" },
        },
      },
    ]);
  });

  it("refuses when the initiator tries to respond to their own reach-out", async () => {
    const exit = await Effect.runPromiseExit(
      respondToReachoutRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(makeLayer({ conversationById: activeConversation({ status: "pending", initiatorUserId: "family-1" }) })),
      ),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "NotConversationReceiverError" });
  });

  it("treats an expired ignored thread as nonexistent", async () => {
    const exit = await Effect.runPromiseExit(
      respondToReachoutRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            conversationById: activeConversation({ status: "ignored", ignoredAt: OLD_IGNORED_AT, initiatorUserId: "family-1" }),
          }),
        ),
      ),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ConversationNotFoundError" });
  });

  it("ignores quietly — no notification is published", async () => {
    const published: Array<Published> = [];
    const layer = makeLayer({
      viewer: providerUser(),
      conversationById: activeConversation({ status: "pending", initiatorUserId: "family-1" }),
      markIgnoredResult: activeConversation({ status: "ignored", ignoredAt: new Date() }),
      published,
    });

    const result = await Effect.runPromise(
      ignoreReachoutRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(layer),
      ),
    );

    expect(result).toEqual({ id: CONVERSATION_ID, status: "ignored" });
    expect(published).toEqual([]);
  });

  it("fails when the reach-out was already handled", async () => {
    const exit = await Effect.runPromiseExit(
      ignoreReachoutRouteProgram(makeContext({ params: { id: CONVERSATION_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            conversationById: activeConversation({ status: "active", initiatorUserId: "family-1" }),
            markIgnoredResult: null,
          }),
        ),
      ),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ConversationNotPendingError" });
  });
});

describe("POST /conversations/:id/messages", () => {
  it("stores the message, bumps the sender's read marker and notifies the other side", async () => {
    const published: Array<Published> = [];
    const reads: Array<[string, string]> = [];
    const layer = makeLayer({
      conversationById: activeConversation(),
      published,
      onMarkRead: (id, side) => reads.push([id, side]),
    });

    const result = await Effect.runPromise(
      sendMessageRouteProgram(
        makeContext({ params: { id: CONVERSATION_ID }, body: { body: "  School pickup at 3:30?  " } }),
        new Headers(),
      ).pipe(Effect.provide(layer)),
    );

    expect(result).toMatchObject({ id: "message-2", body: "School pickup at 3:30?", sentByMe: true });
    expect(reads).toEqual([[CONVERSATION_ID, "family"]]);
    expect(published).toEqual([
      {
        userId: "provider-1",
        input: {
          type: "conversation.message",
          payload: {
            conversationId: CONVERSATION_ID,
            messageId: "message-2",
            senderUserId: "family-1",
            senderName: "Priya Tester",
            preview: "School pickup at 3:30?",
          },
        },
      },
    ]);
  });

  it("stays locked while the reach-out is pending", async () => {
    const exit = await Effect.runPromiseExit(
      sendMessageRouteProgram(
        makeContext({ params: { id: CONVERSATION_ID }, body: { body: "hello" } }),
        new Headers(),
      ).pipe(Effect.provide(makeLayer({ conversationById: activeConversation({ status: "pending" }) }))),
    );
    expect(getFailure(exit)).toMatchObject({ _tag: "ConversationLockedError" });
  });
});
