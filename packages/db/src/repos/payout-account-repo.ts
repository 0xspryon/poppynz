import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { eq, sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { payoutAccount } from '../schema';

export type PayoutAccount = InferSelectModel<typeof payoutAccount>;
export type PayoutAccountStatus = PayoutAccount['status'];
export type PayoutAccountCreateInput = Pick<
  InferInsertModel<typeof payoutAccount>,
  'userId' | 'provider' | 'accountReference'
>;
/** One re-fetched provider snapshot plus the status the API derived from it. */
export type PayoutAccountSnapshotInput = Pick<
  PayoutAccount,
  | 'status'
  | 'detailsSubmitted'
  | 'payoutsEnabled'
  | 'transfersActive'
  | 'requirementsDue'
  | 'disabledReason'
> & { refreshedAt: Date };

export class PayoutAccountRepo extends Context.Tag('@repo/db/PayoutAccountRepo')<
  PayoutAccountRepo,
  {
    findByUserId: (userId: string) => Effect.Effect<PayoutAccount | null, SqlError>;
    /** How an account.updated webhook finds its helper. */
    findByReference: (reference: string) => Effect.Effect<PayoutAccount | null, SqlError>;
    /** Records the helper's account. One account per helper per provider: an
     * existing row for the same provider is returned untouched (a racing
     * second create is a no-op); a row from ANOTHER provider (mock → stripe)
     * is replaced and its snapshot reset. */
    create: (
      input: PayoutAccountCreateInput
    ) => Effect.Effect<PayoutAccount, SqlError | DBNotFoundError>;
    applySnapshot: (
      userId: string,
      snapshot: PayoutAccountSnapshotInput
    ) => Effect.Effect<PayoutAccount, SqlError | DBNotFoundError>;
  }
>() {}

/** What a new or replaced account starts from: nothing fetched yet. */
const unfetched = {
  status: 'onboarding' as const,
  detailsSubmitted: false,
  payoutsEnabled: false,
  transfersActive: false,
  requirementsDue: [] as Array<string>,
  disabledReason: null,
  refreshedAt: null
};

const firstOrNull = (rows: Array<PayoutAccount>) => rows[0] ?? null;

export const PayoutAccountRepoLive = Layer.effect(
  PayoutAccountRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const orNotFound = (userId: string) => (row: PayoutAccount | null | undefined) =>
      row
        ? Effect.succeed(row)
        : Effect.fail(new DBNotFoundError({ entity: 'payoutAccount', value: userId }));

    const findByUserId = (userId: string) =>
      db
        .select()
        .from(payoutAccount)
        .where(eq(payoutAccount.userId, userId))
        .limit(1)
        .pipe(Effect.map(firstOrNull));

    return {
      findByUserId,

      findByReference: (reference) =>
        db
          .select()
          .from(payoutAccount)
          .where(eq(payoutAccount.accountReference, reference))
          .limit(1)
          .pipe(Effect.map(firstOrNull)),

      create: (input) =>
        Effect.gen(function* () {
          const written = yield* db
            .insert(payoutAccount)
            .values(input)
            .onConflictDoUpdate({
              target: payoutAccount.userId,
              set: {
                provider: input.provider,
                accountReference: input.accountReference,
                ...unfetched,
                updatedAt: new Date()
              },
              setWhere: sql`${payoutAccount.provider} <> ${input.provider}`
            })
            .returning();
          if (written[0]) return written[0];
          // Same provider already on file: keep it.
          return yield* findByUserId(input.userId).pipe(Effect.flatMap(orNotFound(input.userId)));
        }),

      applySnapshot: (userId, snapshot) =>
        db
          .update(payoutAccount)
          .set({ ...snapshot, updatedAt: new Date() })
          .where(eq(payoutAccount.userId, userId))
          .returning()
          .pipe(Effect.flatMap((rows) => orNotFound(userId)(rows[0])))
    };
  })
);

export const PayoutAccountRepoDefault = PayoutAccountRepoLive.pipe(Layer.provide(DrizzleLive));

/** Lookups find nothing and writes die unless the test supplies them. */
export const makePayoutAccountRepoTest = (
  implementation: Partial<Context.Tag.Service<PayoutAccountRepo>>
) =>
  Layer.succeed(PayoutAccountRepo, {
    findByUserId: () => Effect.succeed(null),
    findByReference: () => Effect.succeed(null),
    create: () => Effect.die('PayoutAccountRepo.create not stubbed'),
    applySnapshot: () => Effect.die('PayoutAccountRepo.applySnapshot not stubbed'),
    ...implementation
  });

/** A stored account, for fixtures: a Stripe account still onboarding. */
export const dummyPayoutAccount = (overrides: Partial<PayoutAccount> = {}): PayoutAccount => ({
  userId: 'helper-1',
  provider: 'stripe',
  accountReference: 'acct_123',
  status: 'onboarding',
  detailsSubmitted: false,
  payoutsEnabled: false,
  transfersActive: false,
  requirementsDue: [],
  disabledReason: null,
  refreshedAt: new Date(),
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides
});

export type AppliedPayoutSnapshot = { userId: string; snapshot: PayoutAccountSnapshotInput };

/** In-memory stand-in with the live repo's semantics, for unit tests. Every
 * `applySnapshot` is also appended to `applied`. */
export const makeInMemoryPayoutAccountRepo = (
  initial: ReadonlyArray<PayoutAccount> = [],
  applied: Array<AppliedPayoutSnapshot> = []
): {
  layer: Layer.Layer<PayoutAccountRepo>;
  rows: Map<string, PayoutAccount>;
} => {
  const rows = new Map(initial.map((row) => [row.userId, row] as const));
  return {
    rows,
    layer: Layer.succeed(PayoutAccountRepo, {
      findByUserId: (userId) => Effect.succeed(rows.get(userId) ?? null),
      findByReference: (reference) =>
        Effect.succeed(
          [...rows.values()].find((row) => row.accountReference === reference) ?? null
        ),
      create: (input) =>
        Effect.sync(() => {
          const existing = rows.get(input.userId);
          if (existing && existing.provider === input.provider) return existing;
          const row = dummyPayoutAccount({
            ...input,
            ...unfetched,
            createdAt: existing?.createdAt ?? new Date(),
            updatedAt: new Date()
          });
          rows.set(input.userId, row);
          return row;
        }),
      applySnapshot: (userId, snapshot) =>
        Effect.sync(() => {
          applied.push({ userId, snapshot });
          const row = {
            ...(rows.get(userId) ?? dummyPayoutAccount({ userId })),
            ...snapshot,
            updatedAt: new Date()
          };
          rows.set(userId, row);
          return row;
        })
    })
  };
};
