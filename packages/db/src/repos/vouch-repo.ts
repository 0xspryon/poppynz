import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  type InferInsertModel,
  type InferSelectModel,
  or
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { approval, user, userProfile, vouch } from '../schema';

export type Vouch = InferSelectModel<typeof vouch>;
export type NewVouch = InferInsertModel<typeof vouch>;
export type VouchStatus = Vouch['status'];

/** What decides whether a voucher's word counts right now. */
export type VoucherStanding = {
  banned: boolean | null;
  banExpires: Date | null;
  emailVerified: boolean;
  hasLiveApproval: boolean;
};

export type VouchWithVoucher = Vouch & {
  voucher: VoucherStanding & {
    name: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

export type VouchWithApplicant = Vouch & {
  applicant: {
    name: string;
    firstName: string | null;
    lastName: string | null;
    image: string | null;
  };
};

export type VouchTransition = {
  id: string;
  /** The update only applies while the row is in one of these statuses. */
  from: ReadonlyArray<VouchStatus>;
  /** Also require expires_at > now — for actions on a pending request. */
  notExpired?: boolean;
  /** When set, the row must belong to this voucher. */
  voucherUserId?: string;
  set: Partial<
    Pick<
      NewVouch,
      | 'status'
      | 'answers'
      | 'attestedAt'
      | 'submittedIp'
      | 'decidedAt'
      | 'revokedBy'
      | 'adminReason'
    >
  >;
};

export class VouchRepo extends Context.Tag('@repo/db/VouchRepo')<
  VouchRepo,
  {
    create: (input: {
      applicantUserId: string;
      voucherUserId: string;
      voucherRole: 'family' | 'service-provider';
      relationship: string;
      expiresAt: Date;
    }) => Effect.Effect<Vouch, SqlError>;
    findById: (id: string) => Effect.Effect<Vouch, SqlError | DBNotFoundError>;
    /** A pending (unexpired) or accepted vouch between this pair, if any. */
    findOpenByPair: (
      applicantUserId: string,
      voucherUserId: string
    ) => Effect.Effect<Vouch | null, SqlError>;
    listForApplicants: (
      applicantUserIds: ReadonlyArray<string>
    ) => Effect.Effect<Array<VouchWithVoucher>, SqlError>;
    listForVoucher: (voucherUserId: string) => Effect.Effect<Array<VouchWithApplicant>, SqlError>;
    /** Conditional update; null when the row was not in an allowed state. */
    transition: (input: VouchTransition) => Effect.Effect<Vouch | null, SqlError>;
  }
>() {}

export const VouchRepoLive = Layer.effect(
  VouchRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      create: (input) =>
        db
          .insert(vouch)
          .values({ ...input, status: 'pending' })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      findById: (id) =>
        db
          .select()
          .from(vouch)
          .where(eq(vouch.id, id))
          .limit(1)
          .pipe(
            Effect.flatMap((rows) =>
              rows[0]
                ? Effect.succeed(rows[0])
                : Effect.fail(new DBNotFoundError({ entity: 'vouch', value: id }))
            )
          ),
      findOpenByPair: (applicantUserId, voucherUserId) =>
        db
          .select()
          .from(vouch)
          .where(
            and(
              eq(vouch.applicantUserId, applicantUserId),
              eq(vouch.voucherUserId, voucherUserId),
              or(
                eq(vouch.status, 'accepted'),
                and(eq(vouch.status, 'pending'), gt(vouch.expiresAt, new Date()))
              )
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      listForApplicants: (applicantUserIds) =>
        applicantUserIds.length === 0
          ? Effect.succeed([])
          : db
              .select({
                vouch,
                name: user.name,
                email: user.email,
                banned: user.banned,
                banExpires: user.banExpires,
                emailVerified: user.emailVerified,
                firstName: userProfile.firstName,
                lastName: userProfile.lastName,
                currentApprovalId: approval.id
              })
              .from(vouch)
              .innerJoin(user, eq(user.id, vouch.voucherUserId))
              .leftJoin(userProfile, eq(userProfile.userId, vouch.voucherUserId))
              .leftJoin(
                approval,
                and(
                  eq(approval.userId, vouch.voucherUserId),
                  eq(approval.status, 'approved'),
                  gt(approval.expiresAt, new Date())
                )
              )
              .where(inArray(vouch.applicantUserId, [...applicantUserIds]))
              .orderBy(desc(vouch.createdAt))
              .pipe(
                Effect.map((rows) => {
                  // The approval join can fan out; collapse to one row per vouch.
                  const byId = new Map<string, VouchWithVoucher>();
                  for (const row of rows) {
                    const existing = byId.get(row.vouch.id);
                    if (existing) {
                      existing.voucher.hasLiveApproval ||= row.currentApprovalId !== null;
                      continue;
                    }
                    byId.set(row.vouch.id, {
                      ...row.vouch,
                      voucher: {
                        name: row.name,
                        email: row.email,
                        firstName: row.firstName ?? null,
                        lastName: row.lastName ?? null,
                        banned: row.banned,
                        banExpires: row.banExpires,
                        emailVerified: row.emailVerified,
                        hasLiveApproval: row.currentApprovalId !== null
                      }
                    });
                  }
                  return [...byId.values()];
                })
              ),
      listForVoucher: (voucherUserId) =>
        db
          .select({
            vouch,
            name: user.name,
            image: user.image,
            firstName: userProfile.firstName,
            lastName: userProfile.lastName
          })
          .from(vouch)
          .innerJoin(user, eq(user.id, vouch.applicantUserId))
          .leftJoin(userProfile, eq(userProfile.userId, vouch.applicantUserId))
          .where(eq(vouch.voucherUserId, voucherUserId))
          .orderBy(desc(vouch.createdAt))
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                ...row.vouch,
                applicant: {
                  name: row.name,
                  image: row.image,
                  firstName: row.firstName ?? null,
                  lastName: row.lastName ?? null
                }
              }))
            )
          ),
      transition: (input) =>
        db
          .update(vouch)
          .set(input.set)
          .where(
            and(
              eq(vouch.id, input.id),
              inArray(vouch.status, [...input.from]),
              input.notExpired ? gt(vouch.expiresAt, new Date()) : undefined,
              input.voucherUserId ? eq(vouch.voucherUserId, input.voucherUserId) : undefined
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null))
    };
  })
);

export const VouchRepoDefault = VouchRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeVouchRepoTest = (implementation: Context.Tag.Service<VouchRepo>) =>
  Layer.succeed(VouchRepo, implementation);

export const dummyVouch: Vouch = {
  id: 'vouch-1',
  applicantUserId: 'applicant-1',
  voucherUserId: 'voucher-1',
  voucherRole: 'family',
  relationship: 'Neighbour for three years',
  status: 'pending',
  answers: null,
  attestedAt: null,
  submittedIp: null,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  decidedAt: null,
  revokedBy: null,
  adminReason: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z')
};

export const EmptyVouchRepoTest = makeVouchRepoTest({
  create: () => Effect.succeed(dummyVouch),
  findById: (id) => Effect.fail(new DBNotFoundError({ entity: 'vouch', value: id })),
  findOpenByPair: () => Effect.succeed(null),
  listForApplicants: () => Effect.succeed([]),
  listForVoucher: () => Effect.succeed([]),
  transition: () => Effect.succeed(null)
});
