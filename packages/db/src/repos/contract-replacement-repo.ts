import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import * as SqlClient from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import {
  contract,
  contractReplacement,
  contractVersion,
  type ContractServiceItem
} from '../schema';
import type { Contract, ContractVersion } from './contract-repo';

/**
 * Replacement contracts (Tier 3, step 1b — spec 2026-10-28 §1): a short
 * DRAFT contract with another helper, started from a helper's cancellation
 * and pre-filled from the contract it replaces. The link (which contract,
 * which cancelled sessions) is written in the same transaction as the draft,
 * so a replacement never exists without it.
 */

export type ContractReplacementLink = {
  replacesContractId: string;
  /** The cancelled sessions this contract covers, sorted. */
  sessionIds: Array<string>;
};

export type ReplacementDraftInput = {
  conversationId: string;
  familyUserId: string;
  providerUserId: string;
  services: Array<ContractServiceItem>;
  startsOn: string;
  endsOn: string;
  endsAtMinutes: number | null;
  replacesContractId: string;
  sessionIds: ReadonlyArray<string>;
};

export class ContractReplacementRepo extends Context.Tag('@repo/db/ContractReplacementRepo')<
  ContractReplacementRepo,
  {
    /** Inserts the contract, its v1 draft and the replacement link in one
     * transaction. The conversation's negotiating-unique index refuses a
     * second contract under negotiation (SQLSTATE 23505). */
    createDraft: (
      input: ReplacementDraftInput
    ) => Effect.Effect<{ contract: Contract; version: ContractVersion }, SqlError>;
    /** What a contract replaces, or null when it isn't a replacement. */
    findForContract: (
      contractId: string
    ) => Effect.Effect<ContractReplacementLink | null, SqlError>;
    /** Every live replacement of `replacesContractId`'s sessions. */
    listByReplacedContract: (
      replacesContractId: string
    ) => Effect.Effect<Array<{ contractId: string; sessionId: string }>, SqlError>;
  }
>() {}

export const ContractReplacementRepoLive = Layer.effect(
  ContractReplacementRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const sqlClient = yield* SqlClient.SqlClient;

    return {
      createDraft: (input) =>
        sqlClient.withTransaction(
          Effect.gen(function* () {
            const created = (yield* db
              .insert(contract)
              .values({
                conversationId: input.conversationId,
                familyUserId: input.familyUserId,
                providerUserId: input.providerUserId
              })
              .returning())[0]!;
            const version = (yield* db
              .insert(contractVersion)
              .values({
                contractId: created.id,
                version: 1,
                proposedByUserId: input.familyUserId,
                status: 'draft',
                services: input.services,
                startsOn: input.startsOn,
                endsOn: input.endsOn,
                endsAtMinutes: input.endsAtMinutes
              })
              .returning())[0]!;
            yield* db.insert(contractReplacement).values(
              input.sessionIds.map((sessionId) => ({
                contractId: created.id,
                replacesContractId: input.replacesContractId,
                sessionId
              }))
            );
            return { contract: created, version };
          })
        ),
      findForContract: (contractId) =>
        db
          .select()
          .from(contractReplacement)
          .where(eq(contractReplacement.contractId, contractId))
          .orderBy(asc(contractReplacement.sessionId))
          .pipe(
            Effect.map((rows) =>
              rows.length === 0
                ? null
                : {
                    replacesContractId: rows[0]!.replacesContractId,
                    sessionIds: rows.map((row) => row.sessionId)
                  }
            )
          ),
      listByReplacedContract: (replacesContractId) =>
        db
          .select({
            contractId: contractReplacement.contractId,
            sessionId: contractReplacement.sessionId
          })
          .from(contractReplacement)
          .innerJoin(contract, eq(contract.id, contractReplacement.contractId))
          .where(
            and(
              eq(contractReplacement.replacesContractId, replacesContractId),
              isNull(contract.deletedAt)
            )
          )
          .orderBy(asc(contractReplacement.createdAt))
    };
  })
);

export const ContractReplacementRepoDefault = ContractReplacementRepoLive.pipe(
  Layer.provide(DrizzleLive)
);

type ContractReplacementRepoService = Context.Tag.Service<ContractReplacementRepo>;

/** Test layer: nothing is a replacement unless the test says so. */
export const makeContractReplacementRepoTest = (
  implementation: Partial<ContractReplacementRepoService> = {}
) =>
  Layer.succeed(ContractReplacementRepo, {
    createDraft: () => Effect.die(new Error('createDraft not stubbed')),
    findForContract: () => Effect.succeed(null),
    listByReplacedContract: () => Effect.succeed([]),
    ...implementation
  });
