import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  desc,
  eq,
  gt,
  type InferInsertModel,
  type InferSelectModel,
  isNull
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { approval, referral, userProfile } from '../schema';

export type Referral = InferSelectModel<typeof referral>;
export type NewReferral = InferInsertModel<typeof referral>;

/** A referral row joined with what the referrer's list needs to render:
 * the referred person's profile name (once joined) and whether they hold a
 * current approval ("verified"). */
export type ReferralWithReferred = Referral & {
  referredFirstName: string | null;
  referredLastName: string | null;
  referredVerified: boolean;
};

export class ReferralRepo extends Context.Tag('@repo/db/ReferralRepo')<
  ReferralRepo,
  {
    create: (input: {
      referrerUserId: string;
      email: string;
      role: string;
      expiresAt: Date;
    }) => Effect.Effect<Referral, SqlError>;
    listByReferrer: (
      referrerUserId: string
    ) => Effect.Effect<Array<ReferralWithReferred>, SqlError>;
    findPendingByReferrerAndEmail: (
      referrerUserId: string,
      email: string
    ) => Effect.Effect<Referral | null, SqlError>;
    markJoinedByEmail: (
      email: string,
      referredUserId: string
    ) => Effect.Effect<Array<Referral>, SqlError>;
  }
>() {}

export const ReferralRepoLive = Layer.effect(
  ReferralRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      create: (input) =>
        db
          .insert(referral)
          .values({
            id: crypto.randomUUID(),
            referrerUserId: input.referrerUserId,
            email: input.email.toLowerCase(),
            role: input.role,
            expiresAt: input.expiresAt
          })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      listByReferrer: (referrerUserId) =>
        db
          .select({
            referral,
            referredFirstName: userProfile.firstName,
            referredLastName: userProfile.lastName,
            currentApprovalId: approval.id
          })
          .from(referral)
          .leftJoin(userProfile, eq(userProfile.userId, referral.referredUserId))
          .leftJoin(
            approval,
            and(
              eq(approval.userId, referral.referredUserId),
              eq(approval.status, 'approved'),
              gt(approval.expiresAt, new Date())
            )
          )
          .where(eq(referral.referrerUserId, referrerUserId))
          .orderBy(desc(referral.createdAt))
          .pipe(
            Effect.map((rows) => {
              // The approval join can fan out; collapse back to one row per referral.
              const byId = new Map<string, ReferralWithReferred>();
              for (const row of rows) {
                const existing = byId.get(row.referral.id);
                if (existing) {
                  existing.referredVerified ||= row.currentApprovalId !== null;
                  continue;
                }
                byId.set(row.referral.id, {
                  ...row.referral,
                  referredFirstName: row.referredFirstName,
                  referredLastName: row.referredLastName,
                  referredVerified: row.currentApprovalId !== null
                });
              }
              return [...byId.values()];
            })
          ),
      findPendingByReferrerAndEmail: (referrerUserId, email) =>
        db
          .select()
          .from(referral)
          .where(
            and(
              eq(referral.referrerUserId, referrerUserId),
              eq(referral.email, email.toLowerCase()),
              isNull(referral.joinedAt),
              gt(referral.expiresAt, new Date())
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      markJoinedByEmail: (email, referredUserId) =>
        db
          .update(referral)
          .set({ referredUserId, joinedAt: new Date() })
          .where(
            and(
              eq(referral.email, email.toLowerCase()),
              isNull(referral.joinedAt),
              gt(referral.expiresAt, new Date())
            )
          )
          .returning()
    };
  })
);

export const ReferralRepoDefault = ReferralRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeReferralRepoTest = (implementation: Context.Tag.Service<ReferralRepo>) =>
  Layer.succeed(ReferralRepo, implementation);

export const dummyReferral: Referral = {
  id: 'referral-1',
  referrerUserId: 'user-1',
  email: 'invitee@example.com',
  role: 'service-provider',
  referredUserId: null,
  expiresAt: new Date('2026-07-01T00:00:00.000Z'),
  joinedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z')
};

export const EmptyReferralRepoTest = makeReferralRepoTest({
  create: () => Effect.succeed(dummyReferral),
  listByReferrer: () => Effect.succeed([]),
  findPendingByReferrerAndEmail: () => Effect.succeed(null),
  markJoinedByEmail: () => Effect.succeed([])
});
