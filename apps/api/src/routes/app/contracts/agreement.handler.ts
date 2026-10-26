/**
 * Service agreement routes on a contract (UAT round 2, item 4):
 *
 *   GET /contracts/:id/agreement         the agreement the viewer is about to
 *                                        sign (family: their draft; helper:
 *                                        the proposal awaiting them)
 *   GET /contracts/:id/agreement/signed  the signed snapshots, for both
 *                                        parties and for admins (contract
 *                                        review permission)
 */
import { todayIn } from '@repo/calendar';
import { zoneForLocation } from '@repo/calendar/lookup';
import {
  ContractAgreementRepo,
  ContractRepo,
  UserProfileRepo,
  UserRepo,
  toTcLocale,
  type ContractAgreementSignature,
  type TcLocale
} from '@repo/db';
import { Cause, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import { requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import {
  agreementErrorToResponse,
  mapAgreementRepoError as mapRepoError,
  loadAgreementTemplate,
  renderContractAgreement
} from './agreement';
import {
  ContractNotFoundError,
  ContractStateError,
  FamilyLocationRequiredError
} from './contracts.handler';
import { validateContractId } from './contracts.validator';

const loadContract = (contractId: string) =>
  Effect.gen(function* () {
    const repo = yield* ContractRepo;
    const contract = yield* repo.findById(contractId).pipe((errors) => mapRepoError(errors));
    if (!contract) return yield* Effect.fail(new ContractNotFoundError());
    const versions = yield* repo.listVersions(contractId).pipe((errors) => mapRepoError(errors));
    return { contract, versions };
  });

const familyZone = (familyUserId: string) =>
  UserProfileRepo.pipe(
    Effect.flatMap((repo) => repo.findByUserId(familyUserId)),
    Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
    (errors) => mapRepoError(errors),
    Effect.map((profile) =>
      profile?.latitude != null && profile.longitude != null
        ? zoneForLocation(profile.latitude, profile.longitude)
        : null
    )
  );

/** The agreement the viewer would sign now, rendered in their language. */
export const getAgreementToSignProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  locale: TcLocale
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const { contract, versions } = yield* loadContract(contractId);
    const isFamily = contract.familyUserId === viewer.id;
    const isHelper = contract.providerUserId === viewer.id;
    // Same posture as the contract detail: outsiders, and the helper on a
    // family-private draft, see nothing.
    if ((!isFamily && !isHelper) || (isHelper && contract.status === 'draft')) {
      return yield* Effect.fail(new ContractNotFoundError());
    }
    const pending =
      versions.find((version) => version.status === 'draft' || version.status === 'proposed') ??
      null;

    if (isFamily) {
      // Sign & send: the family's own draft, in the zone send will stamp.
      const editable =
        contract.status === 'draft' ||
        contract.status === 'declined' ||
        contract.status === 'changes_requested';
      if (!editable || pending?.status !== 'draft') {
        return yield* Effect.fail(new ContractStateError());
      }
      const timeZone = yield* familyZone(contract.familyUserId);
      if (timeZone === null) return yield* Effect.fail(new FamilyLocationRequiredError());
      const rendered = yield* renderContractAgreement({
        contract,
        terms: { ...pending, timeZone },
        locale,
        revision: null,
        today: todayIn(timeZone)
      });
      return { agreement: toSignResponse(rendered, pending.version, 'family') };
    }

    // Accept & sign: the proposal awaiting the helper, in the template
    // revision the family signed.
    if (
      contract.status !== 'proposed' ||
      pending?.status !== 'proposed' ||
      pending.proposedByUserId === viewer.id ||
      pending.timeZone === null
    ) {
      return yield* Effect.fail(new ContractStateError());
    }
    const signatures = yield* ContractAgreementRepo.pipe(
      Effect.flatMap((repo) => repo.listForContract(contractId)),
      (errors) => mapRepoError(errors)
    );
    const familySigned = signatures.find(
      (signature) =>
        signature.contractVersionId === pending.id &&
        signature.signerSide === 'family' &&
        signature.voidedAt === null
    );
    const rendered = yield* renderContractAgreement({
      contract,
      terms: { ...pending, timeZone: pending.timeZone },
      locale,
      revision: familySigned?.templateVersion ?? null,
      today: todayIn(pending.timeZone)
    });
    return { agreement: toSignResponse(rendered, pending.version, 'helper') };
  });

const toSignResponse = (
  rendered: Effect.Effect.Success<ReturnType<typeof renderContractAgreement>>,
  contractVersion: number,
  side: 'family' | 'helper'
) => ({
  side,
  contractVersion,
  documentId: rendered.document.id,
  title: rendered.document.title,
  versionId: rendered.template.id,
  version: rendered.template.version,
  locale: toTcLocale(rendered.template.locale),
  fallback: rendered.fallback,
  checkboxLabel: rendered.template.checkboxLabel,
  content: rendered.content,
  sha256: rendered.sha256,
  cancellationPolicyVersion: rendered.cancellationPolicy?.version ?? null
});

/**
 * The signed agreement: every signature on the contract, newest terms
 * first. `counts` marks the live signatures on the terms that are (or are
 * proposed to be) in force — a voided one (the family withdrew to edit) or
 * one on declined terms is history.
 */
export const getSignedAgreementProgram = (userAndSession: UserAndSession, contractId: string) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const { contract, versions } = yield* loadContract(contractId);
    const isParty = contract.familyUserId === viewer.id || contract.providerUserId === viewer.id;
    if (!isParty || (contract.providerUserId === viewer.id && contract.status === 'draft')) {
      return yield* Effect.fail(new ContractNotFoundError());
    }
    return yield* signedAgreementView(contract, versions);
  });

export const getSignedAgreementForReviewProgram = (contractId: string) =>
  Effect.gen(function* () {
    const { contract, versions } = yield* loadContract(contractId);
    return yield* signedAgreementView(contract, versions);
  });

const signedAgreementView = (
  contract: Effect.Effect.Success<ReturnType<typeof loadContract>>['contract'],
  versions: Effect.Effect.Success<ReturnType<typeof loadContract>>['versions']
) =>
  Effect.gen(function* () {
    const signatures = yield* ContractAgreementRepo.pipe(
      Effect.flatMap((repo) => repo.listForContract(contract.id)),
      (errors) => mapRepoError(errors)
    );
    const inForce =
      versions.find((version) => version.status === 'accepted') ??
      versions.find((version) => version.status === 'proposed') ??
      null;
    const names = new Map<string, string>();
    for (const userId of new Set(signatures.map((signature) => signature.signerUserId))) {
      names.set(userId, yield* signerName(userId));
    }
    const { document } = yield* loadAgreementTemplate.pipe(
      Effect.catchTag('AgreementUnavailableError', () => Effect.succeed({ document: null }))
    );
    const toSignature = (signature: ContractAgreementSignature) => ({
      id: signature.id,
      side: signature.signerSide,
      signerName: names.get(signature.signerUserId) ?? 'Poppynz member',
      contractVersion: signature.contractVersion,
      templateVersion: signature.templateVersion,
      locale: toTcLocale(signature.locale),
      sha256: signature.contentSha256,
      cancellationPolicyVersion: signature.cancellationPolicyVersion,
      signedAt: signature.signedAt.toISOString(),
      voidedAt: signature.voidedAt?.toISOString() ?? null,
      counts:
        inForce !== null &&
        signature.contractVersionId === inForce.id &&
        signature.voidedAt === null,
      content: signature.content
    });
    return {
      agreement: {
        contractId: contract.id,
        title: document?.title ?? null,
        contractVersion: inForce?.version ?? null,
        signatures: [...signatures].reverse().map(toSignature)
      }
    };
  });

const signerName = (userId: string) =>
  Effect.gen(function* () {
    const profile = yield* UserProfileRepo.pipe(
      Effect.flatMap((repo) => repo.findByUserId(userId)),
      Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
      (errors) => mapRepoError(errors)
    );
    const fromProfile = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
    if (fromProfile) return fromProfile;
    const user = yield* UserRepo.pipe(
      Effect.flatMap((repo) => repo.findById(userId)),
      Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
      (errors) => mapRepoError(errors)
    );
    return user?.name ?? 'Poppynz member';
  });

// ---------------------------------------------------------------------------
// Route programs

export const getAgreementToSignRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['read'] })(
      authenticated
    );
    return yield* getAgreementToSignProgram(
      userAndSession,
      contractId,
      toTcLocale(c.get('language'))
    );
  });

/** Parties read their own contract's agreement; admins hold the contract
 * `review` permission and read any (a permission, never a role check). */
export const getSignedAgreementRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['read'] })(
      authenticated
    );
    const reviewer = yield* requirePermissions(headers, { contract: ['review'] })(
      authenticated
    ).pipe(
      Effect.as(true),
      Effect.catchTag('ForbiddenError', () => Effect.succeed(false))
    );
    return reviewer
      ? yield* getSignedAgreementForReviewProgram(contractId)
      : yield* getSignedAgreementProgram(userAndSession, contractId);
  });

type AgreementRouteError =
  | Effect.Effect.Error<ReturnType<typeof getAgreementToSignRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getSignedAgreementRouteProgram>>;

const agreementRouteErrorToResponse = (c: HonoContext<HonoEnv>, error: AgreementRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'ContractNotFoundError':
      return c.json(
        { error: { code: 'CONTRACT_NOT_FOUND' as const, message: 'Contract not found.' } },
        404
      );
    case 'ContractStateError':
      return c.json(
        {
          error: {
            code: 'CONTRACT_STATE_INVALID' as const,
            message: 'There is nothing for you to sign on this contract right now.'
          }
        },
        409
      );
    case 'FamilyLocationRequiredError':
      return c.json(
        {
          error: {
            code: 'FAMILY_LOCATION_REQUIRED' as const,
            message:
              'Add your address to your profile before sending — session times follow your local time zone.'
          }
        },
        422
      );
    case 'AgreementUnavailableError':
    case 'AgreementRepoError':
      return agreementErrorToResponse(c, error);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, AgreementRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return agreementRouteErrorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function getAgreementToSignHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(getAgreementToSignRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function getSignedAgreementHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(getSignedAgreementRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}
