import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import * as SqlClient from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import { and, asc, eq, inArray, isNull, sql, type InferSelectModel } from 'drizzle-orm';
import { Context, Data, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { contract, contractVersion, userProfile, type ContractServiceItem } from '../schema';

export type Contract = InferSelectModel<typeof contract>;
export type ContractVersion = InferSelectModel<typeof contractVersion>;

/** A contract row joined with what a viewer's list/detail needs to render:
 * the counterpart's profile and every version row (terms, pending proposal,
 * history). Which version is pending/in force is derived from version
 * statuses — see the schema's partial unique indexes. */
export type ContractWithContext = Contract & {
  counterpartUserId: string;
  counterpartFirstName: string | null;
  counterpartLastName: string | null;
  counterpartCity: string | null;
  versions: Array<ContractVersion>;
};

export class ContractRepo extends Context.Tag('@repo/db/ContractRepo')<
  ContractRepo,
  {
    /** Inserts the contract row plus its empty v1 draft. */
    create: (input: {
      conversationId: string;
      familyUserId: string;
      providerUserId: string;
    }) => Effect.Effect<{ contract: Contract; version: ContractVersion }, SqlError>;
    findById: (id: string) => Effect.Effect<Contract | null, SqlError>;
    findByConversationId: (conversationId: string) => Effect.Effect<Contract | null, SqlError>;
    findWithContext: (
      id: string,
      viewerUserId: string
    ) => Effect.Effect<ContractWithContext | null, SqlError>;
    listForUser: (viewerUserId: string) => Effect.Effect<Array<ContractWithContext>, SqlError>;
    listVersions: (contractId: string) => Effect.Effect<Array<ContractVersion>, SqlError>;
    createVersion: (input: {
      contractId: string;
      version: number;
      proposedByUserId: string;
      status: 'draft' | 'proposed';
      services: Array<ContractServiceItem>;
      schedule: string | null;
      startsOn: string | null;
      sentAt?: Date;
    }) => Effect.Effect<ContractVersion, SqlError>;
    /** Guarded `where status = 'draft'`; resolves null when the version is no
     * longer editable. */
    updateVersionTerms: (
      versionId: string,
      input: {
        services: Array<ContractServiceItem>;
        schedule: string | null;
        startsOn: string | null;
      }
    ) => Effect.Effect<ContractVersion | null, SqlError>;
    /** Atomically: version draft → proposed AND contract → proposed. Resolves
     * null (with nothing written) when the version was not a draft. */
    sendPendingVersion: (
      contractId: string,
      versionId: string
    ) => Effect.Effect<ContractVersion | null, SqlError>;
    /** Atomically: version proposed → draft (sent_at cleared) AND contract →
     * restoredStatus. Resolves null when the version was not proposed. */
    withdrawPendingVersion: (
      contractId: string,
      versionId: string,
      restoredStatus: 'draft' | 'declined' | 'changes_requested'
    ) => Effect.Effect<ContractVersion | null, SqlError>;
    /** Terminal retraction of a pending amendment (active contracts have no
     * draft to fall back to): proposed → withdrawn. Resolves null when the
     * version was not proposed. */
    withdrawAmendment: (versionId: string) => Effect.Effect<ContractVersion | null, SqlError>;
    /** Atomically: supersede the currently accepted version (if any), accept
     * the pending one, and optionally activate the contract. The supersede
     * happens first so the accepted-unique index never sees two accepted rows;
     * the whole sequence rolls back (resolving null) when the pending version
     * was no longer proposed — a lost race can never strip an active contract
     * of its in-force terms. */
    acceptPendingVersion: (
      contractId: string,
      versionId: string,
      options: { activate: boolean }
    ) => Effect.Effect<ContractVersion | null, SqlError>;
    /** Atomically: version proposed → declined/changes_requested AND (unless
     * contractStatus is null — the amendment case) the contract along with it.
     * Resolves null when the version was no longer proposed. */
    decidePendingVersion: (
      contractId: string,
      versionId: string,
      input: {
        status: 'declined' | 'changes_requested';
        declineReason?: string | null;
        contractStatus: 'declined' | 'changes_requested' | null;
      }
    ) => Effect.Effect<ContractVersion | null, SqlError>;
    /** active → ending with the 2-weeks-notice fields; resolves null when the
     * contract was not active. */
    setEnding: (
      contractId: string,
      input: { endsOn: string; endedByUserId: string; endNote: string | null }
    ) => Effect.Effect<Contract | null, SqlError>;
    markSeen: (
      contractId: string,
      side: 'family' | 'provider',
      at: Date
    ) => Effect.Effect<void, SqlError>;
  }
>() {}

/** Internal signal that aborts (and rolls back) a compound transaction whose
 * guarded step matched no row; callers observe it as a plain null. */
class TxAbort extends Data.TaggedError('TxAbort')<{}> {}

export const ContractRepoLive = Layer.effect(
  ContractRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const sqlClient = yield* SqlClient.SqlClient;

    /** Runs `body` in a transaction; a TxAbort rolls everything back and
     * resolves null (the guarded-update-missed contract of this repo). */
    const compound = <A>(
      body: Effect.Effect<A, SqlError | TxAbort>
    ): Effect.Effect<A | null, SqlError> =>
      sqlClient.withTransaction(body).pipe(Effect.catchTag('TxAbort', () => Effect.succeed(null)));

    const counterpartId = (viewerUserId: string) =>
      sql<string>`case when ${contract.familyUserId} = ${viewerUserId} then ${contract.providerUserId} else ${contract.familyUserId} end`;

    const selectWithCounterpart = (viewerUserId: string) =>
      db
        .select({
          contract,
          counterpartUserId: counterpartId(viewerUserId),
          counterpartFirstName: userProfile.firstName,
          counterpartLastName: userProfile.lastName,
          counterpartCity: userProfile.city
        })
        .from(contract)
        .leftJoin(userProfile, eq(userProfile.userId, counterpartId(viewerUserId)));

    const withVersions = (
      rows: Array<{
        contract: Contract;
        counterpartUserId: string;
        counterpartFirstName: string | null;
        counterpartLastName: string | null;
        counterpartCity: string | null;
      }>
    ) =>
      Effect.gen(function* () {
        if (rows.length === 0) return [];
        const ids = rows.map((row) => row.contract.id);
        const versions = yield* db
          .select()
          .from(contractVersion)
          .where(inArray(contractVersion.contractId, ids))
          .orderBy(asc(contractVersion.version));
        const versionsById = new Map<string, Array<ContractVersion>>();
        for (const version of versions) {
          const bucket = versionsById.get(version.contractId) ?? [];
          bucket.push(version);
          versionsById.set(version.contractId, bucket);
        }
        return rows
          .map(
            (row): ContractWithContext => ({
              ...row.contract,
              counterpartUserId: row.counterpartUserId,
              counterpartFirstName: row.counterpartFirstName,
              counterpartLastName: row.counterpartLastName,
              counterpartCity: row.counterpartCity,
              versions: versionsById.get(row.contract.id) ?? []
            })
          )
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      });

    /** Bump the contract so list ordering follows negotiation activity. */
    const touchContract = (contractId: string) =>
      db.update(contract).set({ updatedAt: new Date() }).where(eq(contract.id, contractId));

    return {
      create: (input) =>
        Effect.gen(function* () {
          const contractRows = yield* db
            .insert(contract)
            .values({
              conversationId: input.conversationId,
              familyUserId: input.familyUserId,
              providerUserId: input.providerUserId
            })
            .returning();
          const created = contractRows[0];
          const versionRows = yield* db
            .insert(contractVersion)
            .values({
              contractId: created.id,
              version: 1,
              proposedByUserId: input.familyUserId,
              status: 'draft',
              services: [],
              schedule: null,
              startsOn: null
            })
            .returning();
          return { contract: created, version: versionRows[0] };
        }),
      findById: (id) =>
        db
          .select()
          .from(contract)
          .where(and(eq(contract.id, id), isNull(contract.deletedAt)))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      findByConversationId: (conversationId) =>
        db
          .select()
          .from(contract)
          .where(and(eq(contract.conversationId, conversationId), isNull(contract.deletedAt)))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      findWithContext: (id, viewerUserId) =>
        selectWithCounterpart(viewerUserId)
          .where(and(eq(contract.id, id), isNull(contract.deletedAt)))
          .limit(1)
          .pipe(
            Effect.flatMap((rows) => withVersions(rows)),
            Effect.map((rows) => rows[0] ?? null)
          ),
      listForUser: (viewerUserId) =>
        selectWithCounterpart(viewerUserId)
          .where(
            and(
              isNull(contract.deletedAt),
              sql`(${contract.familyUserId} = ${viewerUserId} or ${contract.providerUserId} = ${viewerUserId})`
            )
          )
          .pipe(Effect.flatMap((rows) => withVersions(rows))),
      listVersions: (contractId) =>
        db
          .select()
          .from(contractVersion)
          .where(eq(contractVersion.contractId, contractId))
          .orderBy(asc(contractVersion.version)),
      createVersion: (input) =>
        db
          .insert(contractVersion)
          .values({
            contractId: input.contractId,
            version: input.version,
            proposedByUserId: input.proposedByUserId,
            status: input.status,
            services: input.services,
            schedule: input.schedule,
            startsOn: input.startsOn,
            sentAt: input.sentAt ?? null
          })
          .returning()
          .pipe(
            Effect.map((rows) => rows[0]),
            Effect.tap(() => touchContract(input.contractId))
          ),
      updateVersionTerms: (versionId, input) =>
        db
          .update(contractVersion)
          .set({ services: input.services, schedule: input.schedule, startsOn: input.startsOn })
          .where(and(eq(contractVersion.id, versionId), eq(contractVersion.status, 'draft')))
          .returning()
          .pipe(
            Effect.map((rows) => rows[0] ?? null),
            Effect.tap((row) => (row ? touchContract(row.contractId) : Effect.void))
          ),
      sendPendingVersion: (contractId, versionId) =>
        compound(
          Effect.gen(function* () {
            const rows = yield* db
              .update(contractVersion)
              .set({ status: 'proposed', sentAt: new Date() })
              .where(and(eq(contractVersion.id, versionId), eq(contractVersion.status, 'draft')))
              .returning();
            const version = rows[0];
            if (!version) return yield* Effect.fail(new TxAbort());
            yield* db
              .update(contract)
              .set({ status: 'proposed' })
              .where(and(eq(contract.id, contractId), isNull(contract.deletedAt)));
            return version;
          })
        ),
      withdrawPendingVersion: (contractId, versionId, restoredStatus) =>
        compound(
          Effect.gen(function* () {
            const rows = yield* db
              .update(contractVersion)
              .set({ status: 'draft', sentAt: null })
              .where(and(eq(contractVersion.id, versionId), eq(contractVersion.status, 'proposed')))
              .returning();
            const version = rows[0];
            if (!version) return yield* Effect.fail(new TxAbort());
            yield* db
              .update(contract)
              .set({ status: restoredStatus })
              .where(and(eq(contract.id, contractId), isNull(contract.deletedAt)));
            return version;
          })
        ),
      withdrawAmendment: (versionId) =>
        db
          .update(contractVersion)
          .set({ status: 'withdrawn', decidedAt: new Date() })
          .where(and(eq(contractVersion.id, versionId), eq(contractVersion.status, 'proposed')))
          .returning()
          .pipe(
            Effect.map((rows) => rows[0] ?? null),
            Effect.tap((row) => (row ? touchContract(row.contractId) : Effect.void))
          ),
      acceptPendingVersion: (contractId, versionId, options) =>
        compound(
          Effect.gen(function* () {
            // Supersede before accepting so the accepted-unique partial index
            // never sees two accepted rows; the transaction restores the old
            // accepted version if the pending one was decided concurrently.
            yield* db
              .update(contractVersion)
              .set({ status: 'superseded' })
              .where(
                and(
                  eq(contractVersion.contractId, contractId),
                  eq(contractVersion.status, 'accepted')
                )
              );
            const rows = yield* db
              .update(contractVersion)
              .set({ status: 'accepted', decidedAt: new Date() })
              .where(and(eq(contractVersion.id, versionId), eq(contractVersion.status, 'proposed')))
              .returning();
            const version = rows[0];
            if (!version) return yield* Effect.fail(new TxAbort());
            if (options.activate) {
              yield* db
                .update(contract)
                .set({ status: 'active' })
                .where(and(eq(contract.id, contractId), isNull(contract.deletedAt)));
            } else {
              yield* touchContract(contractId);
            }
            return version;
          })
        ),
      decidePendingVersion: (contractId, versionId, input) =>
        compound(
          Effect.gen(function* () {
            const rows = yield* db
              .update(contractVersion)
              .set({
                status: input.status,
                declineReason: input.declineReason ?? null,
                decidedAt: new Date()
              })
              .where(and(eq(contractVersion.id, versionId), eq(contractVersion.status, 'proposed')))
              .returning();
            const version = rows[0];
            if (!version) return yield* Effect.fail(new TxAbort());
            if (input.contractStatus !== null) {
              yield* db
                .update(contract)
                .set({ status: input.contractStatus })
                .where(and(eq(contract.id, contractId), isNull(contract.deletedAt)));
            } else {
              yield* touchContract(contractId);
            }
            return version;
          })
        ),
      setEnding: (contractId, input) =>
        db
          .update(contract)
          .set({
            status: 'ending',
            endsOn: input.endsOn,
            endedByUserId: input.endedByUserId,
            endNote: input.endNote,
            endNoticedAt: new Date()
          })
          .where(
            and(
              eq(contract.id, contractId),
              eq(contract.status, 'active'),
              isNull(contract.deletedAt)
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      markSeen: (contractId, side, at) =>
        db
          .update(contract)
          // Identity-assign updated_at so $onUpdate doesn't bump it — merely
          // viewing a contract must not reorder anyone's list.
          .set({
            ...(side === 'family' ? { familySeenAt: at } : { providerSeenAt: at }),
            updatedAt: sql`${contract.updatedAt}`
          })
          .where(eq(contract.id, contractId))
          .pipe(Effect.asVoid)
    };
  })
);

export const ContractRepoDefault = ContractRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeContractRepoTest = (implementation: Context.Tag.Service<ContractRepo>) =>
  Layer.succeed(ContractRepo, implementation);

export const dummyContract: Contract = {
  id: 'contract-1',
  conversationId: 'conversation-1',
  familyUserId: 'family-1',
  providerUserId: 'provider-1',
  status: 'draft',
  endsOn: null,
  endedByUserId: null,
  endNote: null,
  endNoticedAt: null,
  familySeenAt: null,
  providerSeenAt: null,
  deletedAt: null,
  createdAt: new Date('2026-08-05T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z')
};

export const dummyContractVersion: ContractVersion = {
  id: 'contract-version-1',
  contractId: 'contract-1',
  version: 1,
  proposedByUserId: 'family-1',
  status: 'draft',
  services: [
    {
      serviceId: 'service-1',
      name: 'Childcare',
      listedRateCents: 2500,
      rateCents: 2600,
      currency: 'CAD',
      hoursPerWeek: 4,
      expectations: 'Reading practice and a snack after school.'
    }
  ],
  schedule: 'Tue & Thu 3:30–6:00 pm',
  startsOn: '2026-08-04',
  sentAt: null,
  decidedAt: null,
  declineReason: null,
  createdAt: new Date('2026-08-05T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z')
};

export const dummyContractWithContext: ContractWithContext = {
  ...dummyContract,
  counterpartUserId: 'provider-1',
  counterpartFirstName: 'Maria',
  counterpartLastName: 'S.',
  counterpartCity: 'Toronto',
  versions: [dummyContractVersion]
};

export const EmptyContractRepoTest = makeContractRepoTest({
  create: () => Effect.succeed({ contract: dummyContract, version: dummyContractVersion }),
  findById: () => Effect.succeed(null),
  findByConversationId: () => Effect.succeed(null),
  findWithContext: () => Effect.succeed(null),
  listForUser: () => Effect.succeed([]),
  listVersions: () => Effect.succeed([]),
  createVersion: () => Effect.succeed(dummyContractVersion),
  updateVersionTerms: () => Effect.succeed(null),
  sendPendingVersion: () => Effect.succeed(null),
  withdrawPendingVersion: () => Effect.succeed(null),
  withdrawAmendment: () => Effect.succeed(null),
  acceptPendingVersion: () => Effect.succeed(null),
  decidePendingVersion: () => Effect.succeed(null),
  setEnding: () => Effect.succeed(null),
  markSeen: () => Effect.void
});
