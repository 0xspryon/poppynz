import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { asc, desc, eq, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { contractAgreementSignature, user } from '../schema';

/** One party's signature on a contract version's service agreement (UAT
 * round 2, item 4) — see the table comment in the schema. */
export type ContractAgreementSignature = InferSelectModel<typeof contractAgreementSignature>;

/** What a signing caller supplies; the contract repo fills in the contract
 * and version it signs inside the send / accept transaction. */
export type ContractAgreementSignatureInput = Omit<
  InferInsertModel<typeof contractAgreementSignature>,
  'id' | 'contractId' | 'contractVersionId' | 'contractVersion' | 'signedAt' | 'voidedAt'
>;

/** A signature for the admin overview: no text, plus who signed. */
export type ContractAgreementSignatureSummary = Omit<ContractAgreementSignature, 'content'> & {
  signerName: string;
  signerEmail: string;
};

export class ContractAgreementRepo extends Context.Tag('@repo/db/ContractAgreementRepo')<
  ContractAgreementRepo,
  {
    /** Every signature on the contract, voided ones included, oldest first. */
    listForContract: (
      contractId: string
    ) => Effect.Effect<Array<ContractAgreementSignature>, SqlError>;
    /** The newest signatures across contracts, for the admin template page. */
    listRecent: (
      limit: number
    ) => Effect.Effect<Array<ContractAgreementSignatureSummary>, SqlError>;
  }
>() {}

export const ContractAgreementRepoLive = Layer.effect(
  ContractAgreementRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    return {
      listForContract: (contractId) =>
        db
          .select()
          .from(contractAgreementSignature)
          .where(eq(contractAgreementSignature.contractId, contractId))
          .orderBy(asc(contractAgreementSignature.signedAt)),
      listRecent: (limit) =>
        db
          .select({
            id: contractAgreementSignature.id,
            contractId: contractAgreementSignature.contractId,
            contractVersionId: contractAgreementSignature.contractVersionId,
            contractVersion: contractAgreementSignature.contractVersion,
            signerUserId: contractAgreementSignature.signerUserId,
            signerSide: contractAgreementSignature.signerSide,
            templateDocumentId: contractAgreementSignature.templateDocumentId,
            templateVersionId: contractAgreementSignature.templateVersionId,
            templateVersion: contractAgreementSignature.templateVersion,
            locale: contractAgreementSignature.locale,
            contentSha256: contractAgreementSignature.contentSha256,
            cancellationPolicyVersionId: contractAgreementSignature.cancellationPolicyVersionId,
            cancellationPolicyVersion: contractAgreementSignature.cancellationPolicyVersion,
            signedAt: contractAgreementSignature.signedAt,
            voidedAt: contractAgreementSignature.voidedAt,
            signerName: user.name,
            signerEmail: user.email
          })
          .from(contractAgreementSignature)
          .innerJoin(user, eq(user.id, contractAgreementSignature.signerUserId))
          .orderBy(desc(contractAgreementSignature.signedAt))
          .limit(limit)
    };
  })
);

export const ContractAgreementRepoDefault = ContractAgreementRepoLive.pipe(
  Layer.provide(DrizzleLive)
);

export const makeContractAgreementRepoTest = (
  implementation: Partial<Context.Tag.Service<ContractAgreementRepo>> = {}
) =>
  Layer.succeed(ContractAgreementRepo, {
    listForContract: () => Effect.succeed([]),
    listRecent: () => Effect.succeed([]),
    ...implementation
  });

export const dummyContractAgreementSignature = (
  overrides: Partial<ContractAgreementSignature> = {}
): ContractAgreementSignature => ({
  id: 'signature-1',
  contractId: 'contract-1',
  contractVersionId: 'contract-version-1',
  contractVersion: 1,
  signerUserId: 'family-1',
  signerSide: 'family',
  templateDocumentId: 'agreement-doc',
  templateVersionId: 'agreement-v1-en',
  templateVersion: 1,
  locale: 'en',
  content: '# Service Agreement',
  contentSha256: '0'.repeat(64),
  cancellationPolicyVersionId: null,
  cancellationPolicyVersion: null,
  signedAt: new Date('2026-10-26T00:00:00.000Z'),
  voidedAt: null,
  ...overrides
});
