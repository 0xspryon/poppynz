import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, asc, count, eq, inArray, isNull, ne, sql, type InferSelectModel } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { conversation, conversationMessage, userProfile, type ReachoutService } from '../schema';

export type Conversation = InferSelectModel<typeof conversation>;
export type ConversationMessage = InferSelectModel<typeof conversationMessage>;

/** A conversation row joined with what a viewer's list/thread needs to render:
 * the counterpart's profile, the latest message preview and how many messages
 * arrived since the viewer last read the thread. */
export type ConversationWithContext = Conversation & {
  counterpartUserId: string;
  counterpartFirstName: string | null;
  counterpartLastName: string | null;
  counterpartCity: string | null;
  lastMessageBody: string | null;
  lastMessageAt: Date | null;
  lastMessageSenderUserId: string | null;
  unreadCount: number;
};

export class ConversationRepo extends Context.Tag('@repo/db/ConversationRepo')<
  ConversationRepo,
  {
    create: (input: {
      familyUserId: string;
      providerUserId: string;
      initiatorUserId: string;
      reachoutMessage: string;
      reachoutServices: Array<ReachoutService>;
    }) => Effect.Effect<Conversation, SqlError>;
    findByPair: (
      familyUserId: string,
      providerUserId: string
    ) => Effect.Effect<Conversation | null, SqlError>;
    findById: (id: string) => Effect.Effect<Conversation | null, SqlError>;
    /** `ignoredCutoff`: rows ignored before this instant are expired and
     * treated as nonexistent (the reach-out cool-down has lapsed). */
    findWithContext: (
      id: string,
      viewerUserId: string,
      ignoredCutoff: Date
    ) => Effect.Effect<ConversationWithContext | null, SqlError>;
    listForUser: (
      viewerUserId: string,
      ignoredCutoff: Date
    ) => Effect.Effect<Array<ConversationWithContext>, SqlError>;
    listMessages: (conversationId: string) => Effect.Effect<Array<ConversationMessage>, SqlError>;
    createMessage: (input: {
      conversationId: string;
      senderUserId: string;
      body: string;
    }) => Effect.Effect<ConversationMessage, SqlError>;
    /** pending|ignored → active (an ignorer may revive by responding within
     * the cool-down); resolves null when the conversation was already active. */
    markResponded: (id: string) => Effect.Effect<Conversation | null, SqlError>;
    /** pending → ignored; resolves null when the conversation was not pending. */
    markIgnored: (id: string) => Effect.Effect<Conversation | null, SqlError>;
    markRead: (id: string, side: 'family' | 'provider', at: Date) => Effect.Effect<void, SqlError>;
    softDeleteById: (id: string) => Effect.Effect<void, SqlError>;
  }
>() {}

export const ConversationRepoLive = Layer.effect(
  ConversationRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    const counterpartId = (viewerUserId: string) =>
      sql<string>`case when ${conversation.familyUserId} = ${viewerUserId} then ${conversation.providerUserId} else ${conversation.familyUserId} end`;

    const viewerLastReadAt = (viewerUserId: string) =>
      sql`case when ${conversation.familyUserId} = ${viewerUserId} then ${conversation.familyLastReadAt} else ${conversation.providerLastReadAt} end`;

    /** Base visibility: participants only, no soft-deleted rows, and no
     * ignored rows past the cool-down cutoff — those are "as if they never
     * existed" for everyone. */
    const visibleTo = (viewerUserId: string, ignoredCutoff: Date) =>
      and(
        isNull(conversation.deletedAt),
        sql`(${conversation.familyUserId} = ${viewerUserId} or ${conversation.providerUserId} = ${viewerUserId})`,
        sql`not (${conversation.status} = 'ignored' and ${conversation.ignoredAt} < ${ignoredCutoff})`
      );

    /** The list additionally hides ignored threads from the ignorer — the
     * thread stays reachable for them via lookup/detail (to revive it), but
     * ignoring keeps it out of their inbox. */
    const listedFor = (viewerUserId: string, ignoredCutoff: Date) =>
      and(
        visibleTo(viewerUserId, ignoredCutoff),
        sql`not (${conversation.status} = 'ignored' and ${conversation.initiatorUserId} <> ${viewerUserId})`
      );

    const withContext = (
      viewerUserId: string,
      rows: Array<{
        conversation: Conversation;
        counterpartUserId: string;
        counterpartFirstName: string | null;
        counterpartLastName: string | null;
        counterpartCity: string | null;
      }>
    ) =>
      Effect.gen(function* () {
        if (rows.length === 0) return [];
        const ids = rows.map((row) => row.conversation.id);

        const lastMessages = yield* db
          .selectDistinctOn([conversationMessage.conversationId])
          .from(conversationMessage)
          .where(
            and(
              inArray(conversationMessage.conversationId, ids),
              isNull(conversationMessage.deletedAt)
            )
          )
          .orderBy(conversationMessage.conversationId, sql`${conversationMessage.createdAt} desc`);

        const unreadCounts = yield* db
          .select({ conversationId: conversationMessage.conversationId, unread: count() })
          .from(conversationMessage)
          .innerJoin(conversation, eq(conversation.id, conversationMessage.conversationId))
          .where(
            and(
              inArray(conversationMessage.conversationId, ids),
              isNull(conversationMessage.deletedAt),
              ne(conversationMessage.senderUserId, viewerUserId),
              sql`${conversationMessage.createdAt} > coalesce(${viewerLastReadAt(viewerUserId)}, 'epoch'::timestamp)`
            )
          )
          .groupBy(conversationMessage.conversationId);

        const lastById = new Map(lastMessages.map((message) => [message.conversationId, message]));
        const unreadById = new Map(unreadCounts.map((row) => [row.conversationId, row.unread]));

        return rows
          .map((row): ConversationWithContext => {
            const last = lastById.get(row.conversation.id);
            return {
              ...row.conversation,
              counterpartUserId: row.counterpartUserId,
              counterpartFirstName: row.counterpartFirstName,
              counterpartLastName: row.counterpartLastName,
              counterpartCity: row.counterpartCity,
              lastMessageBody: last?.body ?? null,
              lastMessageAt: last?.createdAt ?? null,
              lastMessageSenderUserId: last?.senderUserId ?? null,
              unreadCount: unreadById.get(row.conversation.id) ?? 0
            };
          })
          .sort(
            (a, b) =>
              (b.lastMessageAt ?? b.createdAt).getTime() -
              (a.lastMessageAt ?? a.createdAt).getTime()
          );
      });

    const selectWithCounterpart = (viewerUserId: string) =>
      db
        .select({
          conversation,
          counterpartUserId: counterpartId(viewerUserId),
          counterpartFirstName: userProfile.firstName,
          counterpartLastName: userProfile.lastName,
          counterpartCity: userProfile.city
        })
        .from(conversation)
        .leftJoin(userProfile, eq(userProfile.userId, counterpartId(viewerUserId)));

    return {
      create: (input) =>
        db
          .insert(conversation)
          .values({
            familyUserId: input.familyUserId,
            providerUserId: input.providerUserId,
            initiatorUserId: input.initiatorUserId,
            reachoutMessage: input.reachoutMessage,
            reachoutServices: input.reachoutServices
          })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      findByPair: (familyUserId, providerUserId) =>
        db
          .select()
          .from(conversation)
          .where(
            and(
              eq(conversation.familyUserId, familyUserId),
              eq(conversation.providerUserId, providerUserId),
              isNull(conversation.deletedAt)
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      findById: (id) =>
        db
          .select()
          .from(conversation)
          .where(and(eq(conversation.id, id), isNull(conversation.deletedAt)))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      findWithContext: (id, viewerUserId, ignoredCutoff) =>
        selectWithCounterpart(viewerUserId)
          .where(and(eq(conversation.id, id), visibleTo(viewerUserId, ignoredCutoff)))
          .limit(1)
          .pipe(
            Effect.flatMap((rows) => withContext(viewerUserId, rows)),
            Effect.map((rows) => rows[0] ?? null)
          ),
      listForUser: (viewerUserId, ignoredCutoff) =>
        selectWithCounterpart(viewerUserId)
          .where(listedFor(viewerUserId, ignoredCutoff))
          .pipe(Effect.flatMap((rows) => withContext(viewerUserId, rows))),
      listMessages: (conversationId) =>
        db
          .select()
          .from(conversationMessage)
          .where(
            and(
              eq(conversationMessage.conversationId, conversationId),
              isNull(conversationMessage.deletedAt)
            )
          )
          .orderBy(asc(conversationMessage.createdAt)),
      createMessage: (input) =>
        db
          .insert(conversationMessage)
          .values({
            conversationId: input.conversationId,
            senderUserId: input.senderUserId,
            body: input.body
          })
          .returning()
          .pipe(
            Effect.map((rows) => rows[0]),
            Effect.tap(() =>
              // Bump the conversation so list ordering follows activity.
              db
                .update(conversation)
                .set({ updatedAt: new Date() })
                .where(eq(conversation.id, input.conversationId))
            )
          ),
      markResponded: (id) =>
        db
          .update(conversation)
          .set({ status: 'active', respondedAt: new Date(), ignoredAt: null })
          .where(
            and(
              eq(conversation.id, id),
              sql`${conversation.status} in ('pending', 'ignored')`,
              isNull(conversation.deletedAt)
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      markIgnored: (id) =>
        db
          .update(conversation)
          .set({ status: 'ignored', ignoredAt: new Date() })
          .where(
            and(
              eq(conversation.id, id),
              eq(conversation.status, 'pending'),
              isNull(conversation.deletedAt)
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      markRead: (id, side, at) =>
        db
          .update(conversation)
          .set(side === 'family' ? { familyLastReadAt: at } : { providerLastReadAt: at })
          .where(eq(conversation.id, id))
          .pipe(Effect.asVoid),
      softDeleteById: (id) =>
        db
          .update(conversation)
          .set({ deletedAt: new Date() })
          .where(and(eq(conversation.id, id), isNull(conversation.deletedAt)))
          .pipe(Effect.asVoid)
    };
  })
);

export const ConversationRepoDefault = ConversationRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeConversationRepoTest = (implementation: Context.Tag.Service<ConversationRepo>) =>
  Layer.succeed(ConversationRepo, implementation);

export const dummyConversation: Conversation = {
  id: 'conversation-1',
  familyUserId: 'family-1',
  providerUserId: 'provider-1',
  initiatorUserId: 'family-1',
  status: 'pending',
  reachoutMessage: "Hi Maria — I'd like to work with you.",
  reachoutServices: [{ serviceId: 'service-1', name: 'Childcare' }],
  respondedAt: null,
  ignoredAt: null,
  familyLastReadAt: null,
  providerLastReadAt: null,
  deletedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z')
};

export const dummyConversationWithContext: ConversationWithContext = {
  ...dummyConversation,
  counterpartUserId: 'provider-1',
  counterpartFirstName: 'Maria',
  counterpartLastName: 'S.',
  counterpartCity: 'Toronto',
  lastMessageBody: null,
  lastMessageAt: null,
  lastMessageSenderUserId: null,
  unreadCount: 0
};

export const dummyConversationMessage: ConversationMessage = {
  id: 'message-1',
  conversationId: 'conversation-1',
  senderUserId: 'provider-1',
  body: 'Hi Priya! Thanks for reaching out.',
  deletedAt: null,
  createdAt: new Date('2026-08-01T09:32:00.000Z'),
  updatedAt: new Date('2026-08-01T09:32:00.000Z')
};

export const EmptyConversationRepoTest = makeConversationRepoTest({
  create: () => Effect.succeed(dummyConversation),
  findByPair: () => Effect.succeed(null),
  findById: () => Effect.succeed(null),
  findWithContext: () => Effect.succeed(null),
  listForUser: () => Effect.succeed([]),
  listMessages: () => Effect.succeed([]),
  createMessage: () => Effect.succeed(dummyConversationMessage),
  markResponded: () => Effect.succeed(null),
  markIgnored: () => Effect.succeed(null),
  markRead: () => Effect.void,
  softDeleteById: () => Effect.void
});
