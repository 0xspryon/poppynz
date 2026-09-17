import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, eq, gt, inArray, type InferSelectModel, isNull, sql } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { approval, safetyVerification, serviceNeeded, user, userProfile } from '../schema';

export type FamilySearchProfile = InferSelectModel<typeof userProfile> & {
  email: string;
  role: string | null;
  image: string | null;
  banned: boolean | null;
  banExpires: Date | null;
};

export type FamilySearchService = InferSelectModel<typeof serviceNeeded>;

/** The family's live safety verdict, or null. Only a `verified` row is
 * carried: anything else is, for discoverability, the same as nothing. The
 * document builder applies expiry at read time, so `expiresOn` comes along. */
export type FamilySearchVerification = {
  expiresOn: string | null;
};

/** The family's live approval, or null. Like the verdict, only a current
 * `approved` row is carried — the document builder folds its expiry into the
 * read-time cutoff so a lapsed approval hides the family without a reindex. */
export type FamilySearchApproval = {
  expiresAt: Date;
};

export type FamilySearchCandidate = {
  profile: FamilySearchProfile;
  services: Array<FamilySearchService>;
  verification: FamilySearchVerification | null;
  approval: FamilySearchApproval | null;
};

export class FamilySearchRepo extends Context.Tag('@repo/db/FamilySearchRepo')<
  FamilySearchRepo,
  {
    findCandidateByUserId: (
      userId: string
    ) => Effect.Effect<FamilySearchCandidate, SqlError | DBNotFoundError>;
    listCandidatesByUserIds: (
      userIds: Array<string>
    ) => Effect.Effect<Array<FamilySearchCandidate>, SqlError>;
    listFamilyUserIds: () => Effect.Effect<Array<string>, SqlError>;
  }
>() {}

export const FamilySearchRepoLive = Layer.effect(
  FamilySearchRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    const profileSelection = {
      profile: userProfile,
      email: user.email,
      role: user.role,
      image: user.image,
      banned: user.banned,
      banExpires: user.banExpires
    };

    const toProfile = (row: {
      profile: InferSelectModel<typeof userProfile>;
      email: string;
      role: string | null;
      image: string | null;
      banned: boolean | null;
      banExpires: Date | null;
    }): FamilySearchProfile => ({
      ...row.profile,
      email: row.email,
      role: row.role,
      image: row.image,
      banned: row.banned,
      banExpires: row.banExpires
    });

    const findProfile = (userId: string) =>
      db
        .select(profileSelection)
        .from(userProfile)
        .innerJoin(user, eq(userProfile.userId, user.id))
        .where(eq(userProfile.userId, userId))
        .limit(1)
        .pipe(
          Effect.flatMap((rows) => {
            const row = rows[0];
            if (row) return Effect.succeed(toProfile(row));
            return Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId }));
          })
        );

    const listServices = (userId: string) =>
      db
        .select()
        .from(serviceNeeded)
        .where(and(eq(serviceNeeded.userId, userId), isNull(serviceNeeded.deletedAt)));

    // Families are gated on their own safety verdict AND, like helpers, on an
    // admin approval — both feed the index.
    const verifiedVerdicts = (userIds: Array<string>) =>
      db
        .select({ userId: safetyVerification.userId, expiresOn: safetyVerification.expiresOn })
        .from(safetyVerification)
        .where(
          and(
            inArray(safetyVerification.userId, userIds),
            eq(safetyVerification.role, 'family'),
            eq(safetyVerification.status, 'verified'),
            isNull(safetyVerification.deletedAt)
          )
        );

    const liveApprovals = (userIds: Array<string>) =>
      db
        .select({ userId: approval.userId, expiresAt: approval.expiresAt })
        .from(approval)
        .where(
          and(
            inArray(approval.userId, userIds),
            eq(approval.status, 'approved'),
            gt(approval.expiresAt, sql`now()`)
          )
        );

    const listCandidatesByUserIds = (
      userIds: Array<string>
    ): Effect.Effect<Array<FamilySearchCandidate>, SqlError> => {
      if (userIds.length === 0) return Effect.succeed([]);

      return Effect.all(
        {
          profiles: db
            .select(profileSelection)
            .from(userProfile)
            .innerJoin(user, eq(userProfile.userId, user.id))
            .where(inArray(userProfile.userId, userIds)),
          services: db
            .select()
            .from(serviceNeeded)
            .where(and(inArray(serviceNeeded.userId, userIds), isNull(serviceNeeded.deletedAt))),
          verdicts: verifiedVerdicts(userIds),
          approvals: liveApprovals(userIds)
        },
        { concurrency: 'unbounded' }
      ).pipe(
        Effect.map(({ profiles, services, verdicts, approvals }) => {
          const servicesByUserId = new Map<string, Array<FamilySearchService>>();
          for (const row of services) {
            const existing = servicesByUserId.get(row.userId);
            if (existing) existing.push(row);
            else servicesByUserId.set(row.userId, [row]);
          }
          const verdictByUserId = new Map(
            verdicts.map((row) => [row.userId, { expiresOn: row.expiresOn }])
          );
          // Several live rows can coexist briefly (re-approval before expiry);
          // the latest expiry is the one that counts.
          const approvalByUserId = new Map<string, FamilySearchApproval>();
          for (const row of approvals) {
            const existing = approvalByUserId.get(row.userId);
            if (!existing || existing.expiresAt < row.expiresAt) {
              approvalByUserId.set(row.userId, { expiresAt: row.expiresAt });
            }
          }

          return profiles.map((row) => ({
            profile: toProfile(row),
            services: servicesByUserId.get(row.profile.userId) ?? [],
            verification: verdictByUserId.get(row.profile.userId) ?? null,
            approval: approvalByUserId.get(row.profile.userId) ?? null
          }));
        })
      );
    };

    return {
      findCandidateByUserId: (userId) =>
        Effect.all(
          {
            profile: findProfile(userId),
            services: listServices(userId),
            verification: verifiedVerdicts([userId]).pipe(
              Effect.map((rows) => (rows[0] ? { expiresOn: rows[0].expiresOn } : null))
            ),
            approval: liveApprovals([userId]).pipe(
              Effect.map((rows) => {
                const latest = rows.reduce<FamilySearchApproval | null>(
                  (best, row) =>
                    best && best.expiresAt >= row.expiresAt ? best : { expiresAt: row.expiresAt },
                  null
                );
                return latest;
              })
            )
          },
          { concurrency: 'unbounded' }
        ),
      listCandidatesByUserIds,
      listFamilyUserIds: () =>
        db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.role, 'family'))
          .pipe(Effect.map((rows) => rows.map((row) => row.id)))
    };
  })
);

export const FamilySearchRepoDefault = FamilySearchRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeFamilySearchRepoTest = (implementation: Context.Tag.Service<FamilySearchRepo>) =>
  Layer.succeed(FamilySearchRepo, implementation);
