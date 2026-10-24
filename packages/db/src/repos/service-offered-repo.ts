import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, asc, eq, inArray, type InferSelectModel, isNull } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { kycDocument, serviceCatalogueItem, serviceOffered, user, userProfile } from '../schema';
import { isServicePublishable } from '../service-publishability';

export type ServiceOffered = InferSelectModel<typeof serviceOffered>;
export type ServiceReviewStatus = ServiceOffered['reviewStatus'];
/** A service as families may see it, with the base rate its offer floor
 * derives from (null for a custom service). */
export type PublishableService = ServiceOffered & { catalogueBaseRateCents: number | null };
/** A custom service waiting in the admin review queue. */
export type ServiceOfferedForReview = ServiceOffered & {
  helper: { name: string; email: string; firstName: string | null; lastName: string | null };
};
export type ServiceOfferedCreateInput = {
  userId: string;
  catalogueServiceId?: string | null;
  name: string;
  description?: string | null;
  hourlyRateCents: number;
  currency: string;
  reviewStatus?: ServiceReviewStatus;
};
export type ServiceOfferedUpdateInput = Partial<
  Pick<
    ServiceOffered,
    | 'name'
    | 'description'
    | 'hourlyRateCents'
    | 'currency'
    | 'catalogueServiceId'
    | 'reviewStatus'
    | 'reviewedBy'
    | 'reviewedAt'
    | 'reviewReason'
  >
>;
export type ServiceOfferedReviewInput = {
  status: Exclude<ServiceReviewStatus, 'pending'>;
  reviewedBy: string;
  reason: string | null;
};

type ServiceOfferedService = {
  listByUserId: (userId: string) => Effect.Effect<Array<ServiceOffered>, SqlError>;
  /** Only what families may see — see service-publishability.ts. */
  listPublishableByUserIds: (
    userIds: Array<string>
  ) => Effect.Effect<Array<PublishableService>, SqlError>;
  findByIdForUser: (
    id: string,
    userId: string
  ) => Effect.Effect<ServiceOffered, SqlError | DBNotFoundError>;
  create: (input: ServiceOfferedCreateInput) => Effect.Effect<ServiceOffered, SqlError>;
  updateByIdForUser: (
    id: string,
    userId: string,
    input: ServiceOfferedUpdateInput
  ) => Effect.Effect<ServiceOffered, SqlError | DBNotFoundError>;
  softDeleteByIdForUser: (
    id: string,
    userId: string
  ) => Effect.Effect<ServiceOffered, SqlError | DBNotFoundError>;
  /** Live custom services awaiting an admin decision, oldest first. */
  listPendingReview: () => Effect.Effect<Array<ServiceOfferedForReview>, SqlError>;
  /** Decides a PENDING service; anything else is not found. */
  review: (
    id: string,
    input: ServiceOfferedReviewInput
  ) => Effect.Effect<ServiceOffered, SqlError | DBNotFoundError>;
};

export class ServiceOfferedRepo extends Context.Tag('@repo/db/ServiceOfferedRepo')<
  ServiceOfferedRepo,
  ServiceOfferedService
>() {}

/** Applies the publishability rule to joined rows. Exported for the search
 * repo, which loads services for many helpers at once. */
export const filterPublishable = (
  rows: Array<{
    service: ServiceOffered;
    catalogueBaseRateCents: number | null;
    requiredDocumentTypeId: string | null;
  }>,
  approvedDocs: Array<{ userId: string; documentTypeId: string }>
): Array<PublishableService> => {
  const approvedByUser = new Map<string, Set<string>>();
  for (const doc of approvedDocs) {
    const set = approvedByUser.get(doc.userId) ?? new Set<string>();
    set.add(doc.documentTypeId);
    approvedByUser.set(doc.userId, set);
  }
  return rows
    .filter((row) =>
      isServicePublishable(
        {
          catalogueServiceId: row.service.catalogueServiceId,
          reviewStatus: row.service.reviewStatus,
          requiredDocumentTypeId: row.requiredDocumentTypeId
        },
        approvedByUser.get(row.service.userId) ?? new Set()
      )
    )
    .map((row) => ({ ...row.service, catalogueBaseRateCents: row.catalogueBaseRateCents }));
};

type Drizzle = Context.Tag.Service<typeof PgDrizzle.PgDrizzle>;

/** Live services for the given helpers that families may see. Shared with the
 * provider search repo so the index, the profile and bookings agree. */
export const selectPublishableServices = (
  db: Drizzle,
  userIds: Array<string>
): Effect.Effect<Array<PublishableService>, SqlError> =>
  userIds.length === 0
    ? Effect.succeed([])
    : Effect.all(
        [
          db
            .select({
              service: serviceOffered,
              catalogueBaseRateCents: serviceCatalogueItem.baseHourlyRateCents,
              requiredDocumentTypeId: serviceCatalogueItem.requiredDocumentTypeId
            })
            .from(serviceOffered)
            .leftJoin(
              serviceCatalogueItem,
              eq(serviceOffered.catalogueServiceId, serviceCatalogueItem.id)
            )
            .where(and(inArray(serviceOffered.userId, userIds), isNull(serviceOffered.deletedAt))),
          db
            .select({ userId: kycDocument.userId, documentTypeId: kycDocument.documentTypeId })
            .from(kycDocument)
            .where(
              and(
                inArray(kycDocument.userId, userIds),
                eq(kycDocument.status, 'approved'),
                isNull(kycDocument.deletedAt)
              )
            )
        ],
        { concurrency: 'unbounded' }
      ).pipe(Effect.map(([rows, approved]) => filterPublishable(rows, approved)));

export const ServiceOfferedRepoLive = Layer.effect(
  ServiceOfferedRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const oneOrNotFound = (id: string) => (rows: Array<ServiceOffered>) => {
      if (rows[0]) {
        return Effect.succeed(rows[0]);
      }
      return Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id }));
    };

    return {
      listByUserId: (userId) =>
        db
          .select()
          .from(serviceOffered)
          .where(and(eq(serviceOffered.userId, userId), isNull(serviceOffered.deletedAt))),
      listPublishableByUserIds: (userIds) => selectPublishableServices(db, userIds),
      findByIdForUser: (id, userId) =>
        db
          .select()
          .from(serviceOffered)
          .where(
            and(
              eq(serviceOffered.id, id),
              eq(serviceOffered.userId, userId),
              isNull(serviceOffered.deletedAt)
            )
          )
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      create: (input) =>
        db
          .insert(serviceOffered)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      updateByIdForUser: (id, userId, input) =>
        db
          .update(serviceOffered)
          .set({ ...input, updatedAt: new Date() })
          .where(
            and(
              eq(serviceOffered.id, id),
              eq(serviceOffered.userId, userId),
              isNull(serviceOffered.deletedAt)
            )
          )
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      softDeleteByIdForUser: (id, userId) =>
        db
          .update(serviceOffered)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(serviceOffered.id, id),
              eq(serviceOffered.userId, userId),
              isNull(serviceOffered.deletedAt)
            )
          )
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      listPendingReview: () =>
        db
          .select({
            service: serviceOffered,
            name: user.name,
            email: user.email,
            firstName: userProfile.firstName,
            lastName: userProfile.lastName
          })
          .from(serviceOffered)
          .innerJoin(user, eq(serviceOffered.userId, user.id))
          .leftJoin(userProfile, eq(serviceOffered.userId, userProfile.userId))
          .where(and(eq(serviceOffered.reviewStatus, 'pending'), isNull(serviceOffered.deletedAt)))
          .orderBy(asc(serviceOffered.updatedAt))
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                ...row.service,
                helper: {
                  name: row.name,
                  email: row.email,
                  firstName: row.firstName ?? null,
                  lastName: row.lastName ?? null
                }
              }))
            )
          ),
      review: (id, input) =>
        db
          .update(serviceOffered)
          .set({
            reviewStatus: input.status,
            reviewedBy: input.reviewedBy,
            reviewedAt: new Date(),
            reviewReason: input.reason,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(serviceOffered.id, id),
              eq(serviceOffered.reviewStatus, 'pending'),
              isNull(serviceOffered.deletedAt)
            )
          )
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id)))
    };
  })
);

export const ServiceOfferedRepoDefault = ServiceOfferedRepoLive.pipe(Layer.provide(DrizzleLive));

type ReviewMethods = 'listPublishableByUserIds' | 'listPendingReview' | 'review';

/** Test layer. The review-era methods default to behaviour derived from
 * `listByUserId` (publishable = approved, base rate unknown) so older tests
 * keep compiling unchanged. */
export const makeServiceOfferedRepoTest = (
  implementation: Omit<ServiceOfferedService, ReviewMethods> &
    Partial<Pick<ServiceOfferedService, ReviewMethods>>
) =>
  Layer.succeed(ServiceOfferedRepo, {
    listPublishableByUserIds: (userIds) =>
      Effect.forEach(userIds, (userId) => implementation.listByUserId(userId)).pipe(
        Effect.map((lists) =>
          lists
            .flat()
            .filter((service) => (service.reviewStatus ?? 'approved') === 'approved')
            .map((service) => ({ ...service, catalogueBaseRateCents: null }))
        )
      ),
    listPendingReview: () => Effect.succeed([]),
    review: (id) => Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id })),
    ...implementation
  });

export const EmptyServiceOfferedRepoTest = makeServiceOfferedRepoTest({
  listByUserId: () => Effect.succeed([]),
  findByIdForUser: () => Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: '' })),
  create: () => Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: '' }) as never),
  updateByIdForUser: () =>
    Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: '' })),
  softDeleteByIdForUser: () =>
    Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: '' }))
});
