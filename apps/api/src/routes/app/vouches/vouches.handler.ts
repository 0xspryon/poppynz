import type { SqlError } from '@effect/sql/SqlError';
import {
  ApprovalRepo,
  UserProfileRepo,
  UserRepo,
  VouchRepo,
  type VouchWithVoucher
} from '@repo/db';
import { publishNotificationBestEffort } from '@repo/notify';
import { Cause, Data, Effect, Exit, Option, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import {
  RECOMMENDED_VOUCHES,
  VOUCH_MAX_OPEN_REQUESTS,
  VOUCH_MAX_REQUESTS_PER_WINDOW,
  vouchRequestTtlMs,
  vouchRequestWindowMs
} from '@/api/lib/constants';
import { Mailer, sendMailBestEffort } from '@/api/lib/mailer';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import { isUniqueViolation } from '@/api/lib/sql-errors';
import { resolveUiOrigin } from '@/api/lib/ui-origin';
import {
  applicantVouchStatus,
  canVouch,
  pairBlocksNewRequest,
  presentedVouchStatus,
  summariseVouches,
  vouchCounts
} from '@/api/lib/vouches';
import {
  validateVouchAdminActionInput,
  validateVouchRequestInput,
  validateVouchSubmitInput,
  vouchJsonError,
  type VouchRequestInput,
  type VouchSubmitInput
} from './vouches.validator';

export class VouchRepoError extends Data.TaggedError('VouchRepoError')<{ cause: SqlError }> {}
export class VouchApplicantOnlyError extends Data.TaggedError('VouchApplicantOnlyError')<{}> {}
/** One vague error for unknown email, self, wrong role and ineligible
 * voucher — the form must not become a way to probe who is approved. */
export class VoucherUnavailableError extends Data.TaggedError('VoucherUnavailableError')<{}> {}
export class VouchAlreadyRequestedError extends Data.TaggedError(
  'VouchAlreadyRequestedError'
)<{}> {}
export class VouchNotFoundError extends Data.TaggedError('VouchNotFoundError')<{}> {}
export class VouchStateError extends Data.TaggedError('VouchStateError')<{}> {}
export class VouchLockedError extends Data.TaggedError('VouchLockedError')<{}> {}
export class VouchRateLimitedError extends Data.TaggedError('VouchRateLimitedError')<{}> {}

const repoError = (cause: SqlError) => new VouchRepoError({ cause });

const fullName = (
  person: { firstName: string | null; lastName: string | null },
  fallback: string
) => [person.firstName, person.lastName].filter(Boolean).join(' ') || fallback;

const hasLiveApproval = (userId: string) =>
  ApprovalRepo.pipe(
    Effect.flatMap((repo) => repo.findCurrentByUserId(userId)),
    Effect.as(true),
    Effect.catchTags({
      DBNotFoundError: () => Effect.succeed(false),
      SqlError: (cause) => Effect.fail(repoError(cause))
    })
  );

const toApplicantVouch = (vouch: VouchWithVoucher, now: Date) => ({
  id: vouch.id,
  voucherName: fullName(vouch.voucher, vouch.voucher.name),
  voucherEmail: vouch.voucher.email,
  relationship: vouch.relationship,
  status: applicantVouchStatus(vouch, now),
  requestedAt: vouch.createdAt.toISOString()
});

/** The admin's full view of one vouch — answers included. Used by the
 * approval-request detail; never returned from an applicant route. */
export const toAdminVouch = (vouch: VouchWithVoucher, now: Date) => ({
  id: vouch.id,
  voucher: {
    userId: vouch.voucherUserId,
    name: fullName(vouch.voucher, vouch.voucher.name),
    email: vouch.voucher.email,
    role: vouch.voucherRole,
    inGoodStanding: canVouch(vouch.voucher, now)
  },
  relationship: vouch.relationship,
  status: presentedVouchStatus(vouch, now),
  counts: vouchCounts(vouch, now),
  answers: vouch.answers,
  attestedAt: vouch.attestedAt?.toISOString() ?? null,
  submittedIp: vouch.submittedIp,
  requestedAt: vouch.createdAt.toISOString(),
  decidedAt: vouch.decidedAt?.toISOString() ?? null,
  adminReason: vouch.adminReason
});

const loadVoucherOwned = (vouchId: string, voucherUserId: string) =>
  VouchRepo.pipe(
    Effect.flatMap((repo) => repo.findById(vouchId)),
    Effect.catchTags({
      DBNotFoundError: () => Effect.fail(new VouchNotFoundError()),
      SqlError: (cause) => Effect.fail(repoError(cause))
    }),
    Effect.flatMap((vouch) =>
      vouch.voucherUserId === voucherUserId
        ? Effect.succeed(vouch)
        : Effect.fail(new VouchNotFoundError())
    )
  );

export const requestVouchProgram = (
  userAndSession: UserAndSession,
  input: VouchRequestInput,
  context: { uiOrigin: string }
) =>
  Effect.gen(function* () {
    const applicant = userAndSession.user;
    if (applicant.role !== 'service-provider') {
      return yield* Effect.fail(new VouchApplicantOnlyError());
    }
    // Both sides lowercased: input.email is already normalized by the
    // validator, but the applicant's own stored email may not be.
    if (input.email === applicant.email.toLowerCase()) {
      return yield* Effect.fail(new VoucherUnavailableError());
    }

    // Checked before the voucher lookup so the limit also throttles anyone
    // walking the form through a list of emails.
    const vouchRepo = yield* VouchRepo;
    const recent = yield* vouchRepo
      .countRecentByApplicant(applicant.id, new Date(Date.now() - vouchRequestWindowMs))
      .pipe(Effect.mapError(repoError));
    if (
      recent.pendingOpen >= VOUCH_MAX_OPEN_REQUESTS ||
      recent.createdSince >= VOUCH_MAX_REQUESTS_PER_WINDOW
    ) {
      return yield* Effect.fail(new VouchRateLimitedError());
    }

    const userRepo = yield* UserRepo;
    const voucher = yield* userRepo.findByEmail(input.email).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.fail(new VoucherUnavailableError()),
        SqlError: (cause) => Effect.fail(repoError(cause))
      })
    );
    const voucherRole = voucher.role;
    if (
      voucher.id === applicant.id ||
      (voucherRole !== 'family' && voucherRole !== 'service-provider')
    ) {
      return yield* Effect.fail(new VoucherUnavailableError());
    }
    const now = new Date();
    const standing = {
      banned: voucher.banned,
      banExpires: voucher.banExpires,
      emailVerified: voucher.emailVerified,
      hasLiveApproval: yield* hasLiveApproval(voucher.id)
    };
    if (!canVouch(standing, now)) {
      return yield* Effect.fail(new VoucherUnavailableError());
    }

    // A flag/admin revoke, or the voucher's own recent "no", closes the pair —
    // reported with the same vague error so it reveals nothing.
    const history = yield* vouchRepo
      .listByPair(applicant.id, voucher.id)
      .pipe(Effect.mapError(repoError));
    if (pairBlocksNewRequest(history, voucher.id, now)) {
      return yield* Effect.fail(new VoucherUnavailableError());
    }

    const open = yield* vouchRepo
      .findOpenByPair(applicant.id, voucher.id)
      .pipe(Effect.mapError(repoError));
    if (open) {
      return yield* Effect.fail(new VouchAlreadyRequestedError());
    }

    const created = yield* vouchRepo
      .create({
        applicantUserId: applicant.id,
        voucherUserId: voucher.id,
        voucherRole,
        relationship: input.relationship,
        expiresAt: new Date(now.getTime() + vouchRequestTtlMs)
      })
      .pipe(Effect.mapError(repoError));

    const profile = yield* UserProfileRepo.pipe(
      Effect.flatMap((repo) => repo.findByUserId(applicant.id)),
      Effect.catchAll(() => Effect.succeed(null))
    );
    const applicantName = profile ? fullName(profile, applicant.name) : applicant.name;
    const mailer = yield* Mailer;
    yield* sendMailBestEffort(
      'vouch request',
      mailer.sendVouchRequest({
        email: voucher.email,
        applicantName,
        relationship: input.relationship,
        link: new URL(
          voucherRole === 'family' ? '/family/vouches' : '/service-provider/vouches',
          context.uiOrigin
        ).toString()
      })
    );
    yield* publishNotificationBestEffort(voucher.id, {
      type: 'vouch.requested',
      payload: { vouchId: created.id, applicantName }
    });

    return toApplicantVouch(
      {
        ...created,
        voucher: {
          name: voucher.name,
          email: voucher.email,
          firstName: null,
          lastName: null,
          ...standing
        }
      },
      now
    );
  });

export const listMyVouchesProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const vouchRepo = yield* VouchRepo;
    const vouches = yield* vouchRepo
      .listForApplicants([userAndSession.user.id])
      .pipe(Effect.mapError(repoError));
    const now = new Date();
    return {
      vouches: vouches.map((vouch) => toApplicantVouch(vouch, now)),
      counting: summariseVouches(vouches, now).counting,
      recommended: RECOMMENDED_VOUCHES
    };
  });

export const listVouchRequestsProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const vouchRepo = yield* VouchRepo;
    const requests = yield* vouchRepo
      .listForVoucher(userAndSession.user.id)
      .pipe(Effect.mapError(repoError));
    const now = new Date();
    return {
      requests: requests.map((vouch) => ({
        id: vouch.id,
        applicantName: fullName(vouch.applicant, vouch.applicant.name),
        applicantImage: vouch.applicant.image,
        relationship: vouch.relationship,
        status: presentedVouchStatus(vouch, now),
        requestedAt: vouch.createdAt.toISOString(),
        expiresAt: vouch.expiresAt.toISOString()
      }))
    };
  });

const notifyApplicant = (applicantUserId: string) =>
  publishNotificationBestEffort(applicantUserId, { type: 'vouch.updated', payload: {} });

export const submitVouchProgram = (
  userAndSession: UserAndSession,
  vouchId: string,
  input: VouchSubmitInput,
  submittedIp: string | null
) =>
  Effect.gen(function* () {
    const vouch = yield* loadVoucherOwned(vouchId, userAndSession.user.id);
    const now = new Date();
    const updated = yield* VouchRepo.pipe(
      Effect.flatMap((repo) =>
        repo.transition({
          id: vouch.id,
          from: ['pending'],
          notExpired: true,
          voucherUserId: userAndSession.user.id,
          set: {
            status: 'accepted',
            answers: {
              howKnow: input.howKnow,
              howLong: input.howLong,
              wouldTrust: input.wouldTrust,
              hasConcerns: input.hasConcerns,
              concernsDetail: input.concernsDetail ?? null,
              wouldHire: input.wouldHire,
              anythingElse: input.anythingElse ?? null
            },
            attestedAt: now,
            submittedIp,
            decidedAt: now
          }
        })
      ),
      // Two pending requests to the same voucher accepted at once: the
      // one-accepted-per-pair index rejects the loser — a state conflict, not a 500.
      Effect.mapError((cause) =>
        isUniqueViolation(cause) ? new VouchStateError() : repoError(cause)
      )
    );
    if (!updated) {
      return yield* Effect.fail(new VouchStateError());
    }
    yield* notifyApplicant(vouch.applicantUserId);
    return { id: updated.id, status: 'accepted' as const };
  });

export const declineVouchProgram = (userAndSession: UserAndSession, vouchId: string) =>
  Effect.gen(function* () {
    const vouch = yield* loadVoucherOwned(vouchId, userAndSession.user.id);
    const updated = yield* VouchRepo.pipe(
      Effect.flatMap((repo) =>
        repo.transition({
          id: vouch.id,
          from: ['pending'],
          notExpired: true,
          voucherUserId: userAndSession.user.id,
          set: { status: 'declined', decidedAt: new Date() }
        })
      ),
      Effect.mapError(repoError)
    );
    if (!updated) {
      return yield* Effect.fail(new VouchStateError());
    }
    yield* notifyApplicant(vouch.applicantUserId);
    return { id: updated.id, status: 'declined' as const };
  });

export const withdrawVouchProgram = (userAndSession: UserAndSession, vouchId: string) =>
  Effect.gen(function* () {
    const vouch = yield* loadVoucherOwned(vouchId, userAndSession.user.id);
    if (vouch.status !== 'accepted') {
      return yield* Effect.fail(new VouchStateError());
    }
    // Once the applicant is approved the endorsement is part of that decision;
    // changing it is a conversation with Poppynz, not a button.
    if (yield* hasLiveApproval(vouch.applicantUserId)) {
      return yield* Effect.fail(new VouchLockedError());
    }
    const updated = yield* VouchRepo.pipe(
      Effect.flatMap((repo) =>
        repo.transition({
          id: vouch.id,
          from: ['accepted'],
          voucherUserId: userAndSession.user.id,
          set: { status: 'revoked', revokedBy: userAndSession.user.id, decidedAt: new Date() }
        })
      ),
      Effect.mapError(repoError)
    );
    if (!updated) {
      return yield* Effect.fail(new VouchStateError());
    }
    yield* notifyApplicant(vouch.applicantUserId);
    return { id: updated.id, status: 'revoked' as const };
  });

export const adminVouchActionProgram = (
  adminUserId: string,
  vouchId: string,
  action: 'flagged' | 'revoked',
  reason: string
) =>
  Effect.gen(function* () {
    const updated = yield* VouchRepo.pipe(
      Effect.flatMap((repo) =>
        repo.transition({
          id: vouchId,
          from: ['pending', 'accepted'],
          set: {
            status: action,
            revokedBy: adminUserId,
            adminReason: reason,
            decidedAt: new Date()
          }
        })
      ),
      Effect.mapError(repoError)
    );
    if (!updated) {
      return yield* Effect.fail(new VouchStateError());
    }
    yield* notifyApplicant(updated.applicantUserId);
    return { id: updated.id, status: action };
  });

// ---------------------------------------------------------------------------
// Route programs

const authed = (headers: Headers, permission: 'read' | 'write' | 'review') =>
  authenticate(headers).pipe(
    Effect.flatMap((authenticated) =>
      requirePermissions(headers, { vouch: [permission] })(authenticated)
    )
  );

const isUuid = Schema.is(Schema.UUID);

/** A malformed id can't name a vouch: 404 without asking the database. */
const vouchIdParam = (c: HonoContext<HonoEnv>) => {
  const id = c.req.param('id') ?? '';
  return isUuid(id) ? Effect.succeed(id) : Effect.fail(new VouchNotFoundError());
};

/** First hop of the forwarded chain — same rule as the webhook log. */
const sourceIpOf = (c: HonoContext<HonoEnv>): string | null => {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('x-real-ip') || c.req.header('cf-connecting-ip') || null;
};

export const listMyVouchesRouteProgram = (headers: Headers) =>
  authed(headers, 'read').pipe(Effect.flatMap(listMyVouchesProgram));

export const requestVouchRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const input = yield* validateVouchRequestInput(yield* parseJsonBody(c, vouchJsonError));
    const userAndSession = yield* authed(headers, 'write');
    return yield* requestVouchProgram(userAndSession, input, {
      uiOrigin: resolveUiOrigin(headers)
    });
  });

export const listVouchRequestsRouteProgram = (headers: Headers) =>
  authed(headers, 'read').pipe(Effect.flatMap(listVouchRequestsProgram));

export const submitVouchRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const input = yield* validateVouchSubmitInput(yield* parseJsonBody(c, vouchJsonError));
    const userAndSession = yield* authed(headers, 'write');
    const vouchId = yield* vouchIdParam(c);
    return yield* submitVouchProgram(userAndSession, vouchId, input, sourceIpOf(c));
  });

export const declineVouchRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const userAndSession = yield* authed(headers, 'write');
    const vouchId = yield* vouchIdParam(c);
    return yield* declineVouchProgram(userAndSession, vouchId);
  });

export const withdrawVouchRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const userAndSession = yield* authed(headers, 'write');
    const vouchId = yield* vouchIdParam(c);
    return yield* withdrawVouchProgram(userAndSession, vouchId);
  });

export const adminVouchActionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  action: 'flagged' | 'revoked'
) =>
  Effect.gen(function* () {
    const input = yield* validateVouchAdminActionInput(yield* parseJsonBody(c, vouchJsonError));
    const userAndSession = yield* authed(headers, 'review');
    const vouchId = yield* vouchIdParam(c);
    return yield* adminVouchActionProgram(userAndSession.user.id, vouchId, action, input.reason);
  });

export type VouchRouteError =
  | Effect.Effect.Error<ReturnType<typeof listMyVouchesRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof requestVouchRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listVouchRequestsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof submitVouchRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof declineVouchRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof withdrawVouchRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof adminVouchActionRouteProgram>>;

const vouchErrorToResponse = (c: HonoContext<HonoEnv>, error: VouchRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'VouchRepoError':
      return c.json(
        {
          error: { code: 'VOUCH_LOOKUP_FAILED' as const, message: 'Unable to process the vouch.' }
        },
        500
      );
    case 'VouchApplicantOnlyError':
      return c.json(
        {
          error: {
            code: 'VOUCH_APPLICANT_ONLY' as const,
            message: 'Only helpers can ask for vouches.'
          }
        },
        403
      );
    case 'VoucherUnavailableError':
      return c.json(
        {
          error: {
            code: 'VOUCHER_UNAVAILABLE' as const,
            message:
              "We couldn't send a request to that email. Check it belongs to an approved Poppynz member."
          }
        },
        422
      );
    case 'VouchAlreadyRequestedError':
      return c.json(
        {
          error: {
            code: 'VOUCH_ALREADY_REQUESTED' as const,
            message: 'You already have an open request with this person.'
          }
        },
        409
      );
    case 'VouchNotFoundError':
      return c.json(
        {
          error: { code: 'VOUCH_NOT_FOUND' as const, message: 'This vouch request was not found.' }
        },
        404
      );
    case 'VouchStateError':
      return c.json(
        {
          error: {
            code: 'VOUCH_STATE_INVALID' as const,
            message: 'This vouch request has already been answered or has expired.'
          }
        },
        409
      );
    case 'VouchLockedError':
      return c.json(
        {
          error: {
            code: 'VOUCH_LOCKED' as const,
            message: 'This helper is already approved. Contact Poppynz to change your vouch.'
          }
        },
        409
      );
    case 'VouchRateLimitedError':
      return c.json(
        {
          error: {
            code: 'VOUCH_RATE_LIMITED' as const,
            message:
              "You've sent a lot of vouch requests. Please wait for replies before asking more people."
          }
        },
        429
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, VouchRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return vouchErrorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function listMyVouchesHandler(c: HonoContext<HonoEnv>) {
  const exit = await c.get('runtime').runPromiseExit(listMyVouchesRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function requestVouchHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(requestVouchRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function listVouchRequestsHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(listVouchRequestsRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function submitVouchHandler(c: HonoContext<HonoEnv>) {
  const exit = await c.get('runtime').runPromiseExit(submitVouchRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function declineVouchHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(declineVouchRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function withdrawVouchHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(withdrawVouchRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function flagVouchHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(adminVouchActionRouteProgram(c, c.req.raw.headers, 'flagged'));
  return exitToResponse(c, exit);
}

export async function revokeVouchHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(adminVouchActionRouteProgram(c, c.req.raw.headers, 'revoked'));
  return exitToResponse(c, exit);
}
