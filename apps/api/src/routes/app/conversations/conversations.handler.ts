import type { SqlError } from '@effect/sql/SqlError';
import {
  ApprovalRepo,
  ContractRepo,
  ConversationRepo,
  ServiceNeededRepo,
  ServiceOfferedRepo,
  UserProfileRepo,
  UserRepo,
  type Conversation,
  type ConversationMessage,
  type ConversationWithContext,
  type ReachoutService,
  type User
} from '@repo/db';
import { reachoutConfig } from '@repo/env';
import { publishNotificationBestEffort } from '@repo/notify';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '../../../app-env';
import {
  authenticate,
  type UserAndSession,
  requirePermissions,
  authErrorToResponse,
  handleNever
} from '@/api/lib/effect-auth';
import {
  requireVerifiedSafety,
  safetyVerificationGateUnavailableResponseBody,
  safetyVerificationRequiredResponseBody
} from '@/api/lib/safety-verification-gate';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import {
  messageJsonError,
  reachoutJsonError,
  validateConversationId,
  validateLookupUserId,
  validateMessageCreateInput,
  validateReachoutCreateInput
} from './conversations.validator';
import { contractProposalContext, toThreadContractSummary } from '../contracts/contracts.handler';

export class ConversationRepoError extends Data.TaggedError('ConversationRepoError')<{
  cause: SqlError;
}> {}

export class RecipientNotFoundError extends Data.TaggedError('RecipientNotFoundError')<{}> {}

/** The two people must be exactly one family and one service provider. */
export class ConversationPairInvalidError extends Data.TaggedError(
  'ConversationPairInvalidError'
)<{}> {}

export class ConversationExistsError extends Data.TaggedError('ConversationExistsError')<{
  conversationId: string;
}> {}

/** Reach-out blocked without saying why — covers the ignored-pair case so an
 * ignore stays invisible to everyone it should stay invisible to. */
export class ReachoutUnavailableError extends Data.TaggedError('ReachoutUnavailableError')<{}> {}

export class InvalidReachoutServicesError extends Data.TaggedError(
  'InvalidReachoutServicesError'
)<{}> {}

export class ConversationNotFoundError extends Data.TaggedError('ConversationNotFoundError')<{}> {}

export class ConversationNotPendingError extends Data.TaggedError(
  'ConversationNotPendingError'
)<{}> {}

export class NotConversationReceiverError extends Data.TaggedError(
  'NotConversationReceiverError'
)<{}> {}

export class ConversationLockedError extends Data.TaggedError('ConversationLockedError')<{}> {}

/** Reach-outs are how providers contact families they found via search, and
 * search requires a live approval — so initiating one does too. */
export class ProviderNotApprovedError extends Data.TaggedError('ProviderNotApprovedError')<{}> {}

/** Postgres unique-constraint violation (SQLSTATE 23505), possibly nested a
 * few `cause` levels deep depending on the driver wrapping. */
const isUniqueViolation = (error: SqlError): boolean => {
  let current: unknown = error.cause;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

function mapConversationRepoError<A, R>(
  effect: Effect.Effect<A, SqlError, R>
): Effect.Effect<A, ConversationRepoError, R> {
  return effect.pipe(
    Effect.catchTag('SqlError', (cause) => Effect.fail(new ConversationRepoError({ cause })))
  );
}

/** The instant before which an ignore has expired: ignored earlier than this
 * → the cool-down lapsed and the pair may start over. Config read collapses to
 * the default rather than surfacing ConfigError into every route program. */
const reachoutIgnoredCutoff = reachoutConfig.pipe(
  Effect.orElseSucceed(() => ({ ignoreCooldownDays: 120 })),
  Effect.map(
    ({ ignoreCooldownDays }) => new Date(Date.now() - ignoreCooldownDays * 24 * 60 * 60 * 1000)
  )
);

const isExpiredIgnore = (conversation: Conversation, ignoredCutoff: Date) =>
  conversation.status === 'ignored' &&
  conversation.ignoredAt !== null &&
  conversation.ignoredAt < ignoredCutoff;

const displayName = (
  profile: { firstName: string | null; lastName: string | null } | null,
  fallback: string
) => [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || fallback;

const loadProfileOrNull = (userId: string) =>
  UserProfileRepo.pipe(
    Effect.flatMap((repo) => repo.findByUserId(userId)),
    Effect.catchTags({
      DBNotFoundError: () => Effect.succeed(null),
      SqlError: (cause) => Effect.fail(new ConversationRepoError({ cause }))
    })
  );

type ConversationSide = 'family' | 'provider';

const sideOf = (conversation: Conversation, userId: string): ConversationSide =>
  conversation.familyUserId === userId ? 'family' : 'provider';

/** ignored → pending for everyone still allowed to see the row (only the
 * initiator — the ignorer's list query filters theirs out) so an ignore reads
 * as "no response yet" on the sender's side. */
const presentedStatus = (status: Conversation['status']): 'pending' | 'active' =>
  status === 'ignored' ? 'pending' : status;

export const toConversationResponse = (row: ConversationWithContext, viewerUserId: string) => {
  const isInitiator = row.initiatorUserId === viewerUserId;
  const status = presentedStatus(row.status);
  return {
    id: row.id,
    status,
    isInitiator,
    awaitingMyResponse: status === 'pending' && !isInitiator,
    counterpart: {
      userId: row.counterpartUserId,
      name: displayName(
        { firstName: row.counterpartFirstName, lastName: row.counterpartLastName },
        'Poppynz member'
      ),
      city: row.counterpartCity,
      role: (sideOf(row, viewerUserId) === 'family' ? 'service-provider' : 'family') as
        | 'family'
        | 'service-provider'
    },
    reachout: {
      message: row.reachoutMessage,
      services: row.reachoutServices.map((service) => ({
        serviceId: service.serviceId,
        name: service.name
      })),
      sentByMe: isInitiator
    },
    lastMessage:
      row.lastMessageBody !== null && row.lastMessageAt !== null
        ? {
            body: row.lastMessageBody,
            at: row.lastMessageAt.toISOString(),
            sentByMe: row.lastMessageSenderUserId === viewerUserId
          }
        : null,
    unreadCount: row.unreadCount,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
};

const toMessageResponse = (message: ConversationMessage, viewerUserId: string) => ({
  id: message.id,
  body: message.body,
  at: message.createdAt.toISOString(),
  sentByMe: message.senderUserId === viewerUserId
});

const hasUnread = (response: ReturnType<typeof toConversationResponse>) =>
  response.unreadCount > 0 || response.awaitingMyResponse;

/** Renders the fixed reach-out intro — the same for everyone by design, so
 * receivers never need to screen free-text from strangers. */
const reachoutTemplate = (input: {
  senderRole: 'family' | 'service-provider';
  recipientFirstName: string | null;
  senderCity: string | null;
}) => {
  const greeting = `Hi ${input.recipientFirstName ?? 'there'} — I'd like to work with you.`;
  const location = input.senderCity
    ? input.senderRole === 'family'
      ? ` We're in ${input.senderCity}.`
      : ` I'm in ${input.senderCity}.`
    : '';
  const closing =
    input.senderRole === 'family'
      ? ' Take a look at my family profile and the services we need below.'
      : ' Take a look at my profile and the services I offer below.';
  return `${greeting}${location}${closing}`;
};

const resolvePair = (sender: User, recipient: User) => {
  if (sender.role === 'family' && recipient.role === 'service-provider') {
    return { familyUserId: sender.id, providerUserId: recipient.id };
  }
  if (sender.role === 'service-provider' && recipient.role === 'family') {
    return { familyUserId: recipient.id, providerUserId: sender.id };
  }
  return null;
};

export const createReachoutProgram = (
  userAndSession: UserAndSession,
  input: { recipientUserId: string; serviceIds: ReadonlyArray<string> }
) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const conversationRepo = yield* ConversationRepo;
    const sender = userAndSession.user;

    if (input.recipientUserId === sender.id) {
      return yield* Effect.fail(new ConversationPairInvalidError());
    }

    const recipient = yield* userRepo.findById(input.recipientUserId).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.fail(new RecipientNotFoundError()),
        SqlError: (cause) => Effect.fail(new ConversationRepoError({ cause }))
      })
    );

    const pair = resolvePair(sender, recipient);
    if (!pair) {
      return yield* Effect.fail(new ConversationPairInvalidError());
    }

    // Mirrors the family-search gate: the permission says a provider MAY
    // contact families, a live approval says they may do it RIGHT NOW.
    // Existing conversations are unaffected — revocation stops new contacts.
    // Safety verification gates BOTH sides. The approval check below stays
    // helper-specific because approval is a helper concept; verification is
    // not, and applying it to only one role is how families ended up ungated.
    yield* requireVerifiedSafety(userAndSession);

    if (sender.role === 'service-provider') {
      const approvalRepo = yield* ApprovalRepo;
      const approval = yield* approvalRepo.findCurrentByUserId(sender.id).pipe(
        Effect.catchTags({
          DBNotFoundError: () => Effect.succeed(null),
          SqlError: (cause) => Effect.fail(new ConversationRepoError({ cause }))
        })
      );
      if (!approval) {
        return yield* Effect.fail(new ProviderNotApprovedError());
      }
    }

    const ignoredCutoff = yield* reachoutIgnoredCutoff;
    const existing = yield* conversationRepo
      .findByPair(pair.familyUserId, pair.providerUserId)
      .pipe((errors) => mapConversationRepoError(errors));
    if (existing) {
      if (isExpiredIgnore(existing, ignoredCutoff)) {
        // Cool-down lapsed: the old thread is history for both sides — archive
        // it and let this reach-out start the pair over.
        yield* conversationRepo
          .softDeleteById(existing.id)
          .pipe((errors) => mapConversationRepoError(errors));
      } else if (existing.status === 'ignored' && existing.initiatorUserId !== sender.id) {
        // The sender is the one who ignored — within the cool-down their path
        // back is responding to the original reach-out, not sending a new one.
        return yield* Effect.fail(new ReachoutUnavailableError());
      } else {
        return yield* Effect.fail(new ConversationExistsError({ conversationId: existing.id }));
      }
    }

    // The selectable set belongs to the *other* side of the reach-out: a family
    // picks from the provider's offering, a provider from the family's needs.
    const selectableServices =
      sender.role === 'family'
        ? yield* ServiceOfferedRepo.pipe(
            Effect.flatMap((repo) => repo.listByUserId(pair.providerUserId)),
            (errors) => mapConversationRepoError(errors)
          )
        : yield* ServiceNeededRepo.pipe(
            Effect.flatMap((repo) => repo.listByUserId(pair.familyUserId)),
            (errors) => mapConversationRepoError(errors)
          );
    const selectableById = new Map(selectableServices.map((service) => [service.id, service]));
    const services: Array<ReachoutService> = [];
    for (const serviceId of input.serviceIds) {
      const service = selectableById.get(serviceId);
      if (!service) {
        return yield* Effect.fail(new InvalidReachoutServicesError());
      }
      services.push({ serviceId: service.id, name: service.name });
    }

    const senderProfile = yield* loadProfileOrNull(sender.id);
    const recipientProfile = yield* loadProfileOrNull(recipient.id);

    const conversation = yield* conversationRepo
      .create({
        ...pair,
        initiatorUserId: sender.id,
        reachoutMessage: reachoutTemplate({
          senderRole: sender.role as 'family' | 'service-provider',
          recipientFirstName: recipientProfile?.firstName ?? null,
          senderCity: senderProfile?.city ?? null
        }),
        reachoutServices: services
      })
      .pipe(
        // The check-then-insert above is not atomic: a simultaneous reach-out
        // for the same pair loses the partial unique index race. Surface that
        // as the same 409 the check would have produced, not a 500.
        Effect.catchTag('SqlError', (cause) =>
          isUniqueViolation(cause)
            ? conversationRepo.findByPair(pair.familyUserId, pair.providerUserId).pipe(
                (errors) => mapConversationRepoError(errors),
                Effect.flatMap((winner) =>
                  Effect.fail(
                    winner
                      ? new ConversationExistsError({ conversationId: winner.id })
                      : new ConversationRepoError({ cause })
                  )
                )
              )
            : Effect.fail(new ConversationRepoError({ cause }))
        )
      );

    yield* publishNotificationBestEffort(recipient.id, {
      type: 'conversation.reachout',
      payload: {
        conversationId: conversation.id,
        senderName: displayName(senderProfile, sender.name)
      }
    });

    return { id: conversation.id };
  });

export const listConversationsProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const conversationRepo = yield* ConversationRepo;
    const ignoredCutoff = yield* reachoutIgnoredCutoff;
    const rows = yield* conversationRepo
      .listForUser(userAndSession.user.id, ignoredCutoff)
      .pipe((errors) => mapConversationRepoError(errors));
    const conversations = rows.map((row) => toConversationResponse(row, userAndSession.user.id));
    return {
      conversations,
      unreadTotal: conversations.filter(hasUnread).length
    };
  });

export const unreadCountProgram = (userAndSession: UserAndSession) =>
  listConversationsProgram(userAndSession).pipe(
    Effect.map((result) => ({ total: result.unreadTotal }))
  );

export const lookupConversationProgram = (
  userAndSession: UserAndSession,
  counterpartUserId: string
) =>
  Effect.gen(function* () {
    const conversationRepo = yield* ConversationRepo;
    const viewer = userAndSession.user;
    const pair =
      viewer.role === 'family'
        ? { familyUserId: viewer.id, providerUserId: counterpartUserId }
        : viewer.role === 'service-provider'
          ? { familyUserId: counterpartUserId, providerUserId: viewer.id }
          : null;
    if (!pair) return { conversation: null };

    const ignoredCutoff = yield* reachoutIgnoredCutoff;
    const existing = yield* conversationRepo
      .findByPair(pair.familyUserId, pair.providerUserId)
      .pipe((errors) => mapConversationRepoError(errors));
    if (!existing || isExpiredIgnore(existing, ignoredCutoff)) {
      // No conversation, or the ignore cool-down lapsed — either way the pair
      // may start over, so the composer opens.
      return { conversation: null };
    }
    // Within the cool-down an ignored thread still resolves here for BOTH
    // sides: the initiator sees it as pending (the ignore stays secret), and
    // the ignorer gets routed to the thread where Respond can revive it.
    const status = presentedStatus(existing.status);
    return {
      conversation: {
        id: existing.id,
        status,
        isInitiator: existing.initiatorUserId === viewer.id,
        awaitingMyResponse: status === 'pending' && existing.initiatorUserId !== viewer.id
      }
    };
  });

export const getConversationProgram = (userAndSession: UserAndSession, conversationId: string) =>
  Effect.gen(function* () {
    const conversationRepo = yield* ConversationRepo;
    const viewer = userAndSession.user;
    const ignoredCutoff = yield* reachoutIgnoredCutoff;
    const row = yield* conversationRepo
      .findWithContext(conversationId, viewer.id, ignoredCutoff)
      .pipe((errors) => mapConversationRepoError(errors));
    if (!row) {
      return yield* Effect.fail(new ConversationNotFoundError());
    }
    const messages = yield* conversationRepo
      .listMessages(conversationId)
      .pipe((errors) => mapConversationRepoError(errors));

    // The thread renders contract state (the 16h/16j pills) from this summary
    // — contract rows never enter conversation_messages.
    const contractRepo = yield* ContractRepo;
    const contractRow = yield* contractRepo
      .findByConversationId(conversationId)
      .pipe((errors) => mapConversationRepoError(errors));
    let contract: ReturnType<typeof toThreadContractSummary> = null;
    if (contractRow) {
      const versions = yield* contractRepo
        .listVersions(contractRow.id)
        .pipe((errors) => mapConversationRepoError(errors));
      const { cutoff } = yield* contractProposalContext;
      contract = toThreadContractSummary(contractRow, versions, viewer.id, cutoff);
    }

    return {
      conversation: toConversationResponse(row, viewer.id),
      messages: messages.map((message) => toMessageResponse(message, viewer.id)),
      contract
    };
  });

const loadParticipantConversation = (conversationId: string, viewerUserId: string) =>
  Effect.gen(function* () {
    const conversationRepo = yield* ConversationRepo;
    const ignoredCutoff = yield* reachoutIgnoredCutoff;
    const conversation = yield* conversationRepo
      .findById(conversationId)
      .pipe((errors) => mapConversationRepoError(errors));
    if (
      !conversation ||
      (conversation.familyUserId !== viewerUserId &&
        conversation.providerUserId !== viewerUserId) ||
      isExpiredIgnore(conversation, ignoredCutoff)
    ) {
      return yield* Effect.fail(new ConversationNotFoundError());
    }
    return conversation;
  });

export const respondToReachoutProgram = (userAndSession: UserAndSession, conversationId: string) =>
  Effect.gen(function* () {
    const conversationRepo = yield* ConversationRepo;
    const viewer = userAndSession.user;
    const conversation = yield* loadParticipantConversation(conversationId, viewer.id);
    if (conversation.initiatorUserId === viewer.id) {
      return yield* Effect.fail(new NotConversationReceiverError());
    }
    // markResponded transitions pending AND ignored rows: responding to a
    // still-within-cool-down ignored reach-out is exactly how the ignorer
    // revives the conversation (expired ones already 404'd above).
    const updated = yield* conversationRepo
      .markResponded(conversationId)
      .pipe((errors) => mapConversationRepoError(errors));
    if (!updated) {
      return yield* Effect.fail(new ConversationNotPendingError());
    }

    const responderProfile = yield* loadProfileOrNull(viewer.id);
    yield* publishNotificationBestEffort(conversation.initiatorUserId, {
      type: 'conversation.unlocked',
      payload: {
        conversationId,
        responderName: displayName(responderProfile, viewer.name)
      }
    });

    return {
      id: updated.id,
      status: 'active' as const,
      respondedAt: updated.respondedAt?.toISOString() ?? null
    };
  });

export const ignoreReachoutProgram = (userAndSession: UserAndSession, conversationId: string) =>
  Effect.gen(function* () {
    const conversationRepo = yield* ConversationRepo;
    const viewer = userAndSession.user;
    const conversation = yield* loadParticipantConversation(conversationId, viewer.id);
    if (conversation.initiatorUserId === viewer.id) {
      return yield* Effect.fail(new NotConversationReceiverError());
    }
    const updated = yield* conversationRepo
      .markIgnored(conversationId)
      .pipe((errors) => mapConversationRepoError(errors));
    if (!updated) {
      return yield* Effect.fail(new ConversationNotPendingError());
    }
    // Deliberately no notification: ignoring is invisible to the sender.
    return { id: updated.id, status: 'ignored' as const };
  });

export const sendMessageProgram = (
  userAndSession: UserAndSession,
  conversationId: string,
  input: { body: string }
) =>
  Effect.gen(function* () {
    const conversationRepo = yield* ConversationRepo;
    const viewer = userAndSession.user;
    const conversation = yield* loadParticipantConversation(conversationId, viewer.id);
    if (conversation.status !== 'active') {
      return yield* Effect.fail(new ConversationLockedError());
    }

    const message = yield* conversationRepo
      .createMessage({ conversationId, senderUserId: viewer.id, body: input.body })
      .pipe((errors) => mapConversationRepoError(errors));
    // Sending implies the sender has the thread open — keep their read marker
    // current so their own list never flags this conversation as unread.
    yield* conversationRepo
      .markRead(conversationId, sideOf(conversation, viewer.id), message.createdAt)
      .pipe((errors) => mapConversationRepoError(errors));

    const senderProfile = yield* loadProfileOrNull(viewer.id);
    const recipientUserId =
      conversation.familyUserId === viewer.id
        ? conversation.providerUserId
        : conversation.familyUserId;
    yield* publishNotificationBestEffort(recipientUserId, {
      type: 'conversation.message',
      payload: {
        conversationId,
        messageId: message.id,
        senderUserId: viewer.id,
        senderName: displayName(senderProfile, viewer.name),
        preview: message.body.slice(0, 140)
      }
    });

    return toMessageResponse(message, viewer.id);
  });

export const markConversationReadProgram = (
  userAndSession: UserAndSession,
  conversationId: string
) =>
  Effect.gen(function* () {
    const conversationRepo = yield* ConversationRepo;
    const viewer = userAndSession.user;
    const conversation = yield* loadParticipantConversation(conversationId, viewer.id);
    yield* conversationRepo
      .markRead(conversationId, sideOf(conversation, viewer.id), new Date())
      .pipe((errors) => mapConversationRepoError(errors));
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Route programs (parse + validate + authenticate + authorize + domain)

export const createReachoutRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, reachoutJsonError);
    const input = yield* validateReachoutCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { conversation: ['write'] })(
      authenticated
    );
    return yield* createReachoutProgram(userAndSession, input);
  });

export const listConversationsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { conversation: ['read'] })(
      authenticated
    );
    return yield* listConversationsProgram(userAndSession);
  });

export const unreadCountRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { conversation: ['read'] })(
      authenticated
    );
    return yield* unreadCountProgram(userAndSession);
  });

export const lookupConversationRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const counterpartUserId = yield* validateLookupUserId(c.req.query('userId'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { conversation: ['read'] })(
      authenticated
    );
    return yield* lookupConversationProgram(userAndSession, counterpartUserId);
  });

export const getConversationRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const conversationId = yield* validateConversationId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { conversation: ['read'] })(
      authenticated
    );
    return yield* getConversationProgram(userAndSession, conversationId);
  });

export const respondToReachoutRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const conversationId = yield* validateConversationId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { conversation: ['write'] })(
      authenticated
    );
    return yield* respondToReachoutProgram(userAndSession, conversationId);
  });

export const ignoreReachoutRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const conversationId = yield* validateConversationId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { conversation: ['write'] })(
      authenticated
    );
    return yield* ignoreReachoutProgram(userAndSession, conversationId);
  });

export const sendMessageRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const conversationId = yield* validateConversationId(c.req.param('id'));
    const rawBody = yield* parseJsonBody(c, messageJsonError);
    const input = yield* validateMessageCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { conversation: ['write'] })(
      authenticated
    );
    return yield* sendMessageProgram(userAndSession, conversationId, input);
  });

export const markConversationReadRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const conversationId = yield* validateConversationId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { conversation: ['write'] })(
      authenticated
    );
    return yield* markConversationReadProgram(userAndSession, conversationId);
  });

export type ConversationRouteError =
  | Effect.Effect.Error<ReturnType<typeof createReachoutRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listConversationsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof unreadCountRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof lookupConversationRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getConversationRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof respondToReachoutRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof ignoreReachoutRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof sendMessageRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof markConversationReadRouteProgram>>;

const conversationRouteErrorToResponse = (
  c: HonoContext<HonoEnv>,
  error: ConversationRouteError
) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'ConversationRepoError':
      return c.json(
        {
          error: {
            code: 'CONVERSATION_LOOKUP_FAILED' as const,
            message: 'Unable to process the conversation.'
          }
        },
        500
      );
    case 'RecipientNotFoundError':
      return c.json(
        {
          error: {
            code: 'RECIPIENT_NOT_FOUND' as const,
            message: 'This person could not be found.'
          }
        },
        404
      );
    case 'ConversationPairInvalidError':
      return c.json(
        {
          error: {
            code: 'CONVERSATION_PAIR_INVALID' as const,
            message: 'Conversations happen between a family and a provider.'
          }
        },
        422
      );
    case 'ConversationExistsError':
      return c.json(
        {
          error: {
            code: 'CONVERSATION_EXISTS' as const,
            message: 'You already have a conversation with this person.',
            conversationId: error.conversationId
          }
        },
        409
      );
    case 'ReachoutUnavailableError':
      return c.json(
        {
          error: {
            code: 'REACHOUT_UNAVAILABLE' as const,
            message: "You can't reach out to this person right now."
          }
        },
        409
      );
    case 'InvalidReachoutServicesError':
      return c.json(
        {
          error: {
            code: 'INVALID_REACHOUT_SERVICES' as const,
            message: "Pick services from this person's current list."
          }
        },
        422
      );
    case 'ConversationNotFoundError':
      return c.json(
        { error: { code: 'CONVERSATION_NOT_FOUND' as const, message: 'Conversation not found.' } },
        404
      );
    case 'ConversationNotPendingError':
      return c.json(
        {
          error: {
            code: 'CONVERSATION_NOT_PENDING' as const,
            message: 'This reach-out has already been handled.'
          }
        },
        409
      );
    case 'NotConversationReceiverError':
      return c.json(
        {
          error: {
            code: 'NOT_CONVERSATION_RECEIVER' as const,
            message: 'Only the person who received the reach-out can do this.'
          }
        },
        403
      );
    case 'ConversationLockedError':
      return c.json(
        {
          error: {
            code: 'CONVERSATION_LOCKED' as const,
            message: 'This conversation is locked until the reach-out gets a response.'
          }
        },
        409
      );
    case 'SafetyVerificationRequiredError':
      return c.json({ error: safetyVerificationRequiredResponseBody }, 403);
    case 'SafetyVerificationGateUnavailableError':
      return c.json({ error: safetyVerificationGateUnavailableResponseBody }, 503);
    case 'ProviderNotApprovedError':
      return c.json(
        {
          error: {
            code: 'PROVIDER_NOT_APPROVED' as const,
            message: 'You need a current approval before reaching out to families.'
          }
        },
        403
      );
    default:
      return handleNever(c, error);
  }
};

const unexpectedErrorResponse = (c: HonoContext<HonoEnv>) =>
  c.json(
    { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
    500
  );

const exitToResponse = <TData>(
  c: HonoContext<HonoEnv>,
  exit: Exit.Exit<TData, ConversationRouteError>
) =>
  Exit.match(exit, {
    onSuccess: (data) => c.json(data),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return conversationRouteErrorToResponse(c, failure.value);
      }
      return unexpectedErrorResponse(c);
    }
  });

export async function createReachoutHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(createReachoutRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function listConversationsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(listConversationsRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function unreadCountHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(unreadCountRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function lookupConversationHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(lookupConversationRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function getConversationHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(getConversationRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function respondToReachoutHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(respondToReachoutRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function ignoreReachoutHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(ignoreReachoutRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function sendMessageHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(sendMessageRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function markConversationReadHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(markConversationReadRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}
