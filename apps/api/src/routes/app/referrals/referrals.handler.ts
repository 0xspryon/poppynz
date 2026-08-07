import type { SqlError } from '@effect/sql/SqlError';
import {
  ReferralRepo,
  type ReferralWithReferred,
  SignupIntentRepo,
  UserProfileRepo,
  UserRepo
} from '@repo/db';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '../../../app-env';
import {
  authenticate,
  type UserAndSession,
  requirePermissions,
  authErrorToResponse,
  handleNever
} from '@/api/lib/effect-auth';
import { referralInviteTtlMs } from '@/api/lib/constants';
import { Mailer } from '@/api/lib/mailer';
import { resolveUiOrigin } from '@/api/lib/ui-origin';
import { referralJsonError, validateReferralCreateInput } from './referrals.validator';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';

export class ReferralRepoError extends Data.TaggedError('ReferralRepoError')<{
  cause: SqlError;
}> {}

export class ReferralAlreadyInvitedError extends Data.TaggedError(
  'ReferralAlreadyInvitedError'
)<{}> {}

export class ReferralEmailAlreadyMemberError extends Data.TaggedError(
  'ReferralEmailAlreadyMemberError'
)<{}> {}

export type ReferralStatus = 'invited' | 'joined' | 'expired';

const referralStatus = (referral: ReferralWithReferred, now: Date): ReferralStatus => {
  if (referral.joinedAt) return 'joined';
  return referral.expiresAt < now ? 'expired' : 'invited';
};

const toReferralResponse = (referral: ReferralWithReferred, now: Date) => {
  const name = [referral.referredFirstName, referral.referredLastName].filter(Boolean).join(' ');
  return {
    id: referral.id,
    email: referral.email,
    role: referral.role,
    status: referralStatus(referral, now),
    name: name || null,
    verified: referral.referredVerified,
    invitedAt: referral.createdAt.toISOString(),
    joinedAt: referral.joinedAt?.toISOString() ?? null
  };
};

export const listReferralsProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const referralRepo = yield* ReferralRepo;
    const referrals = yield* referralRepo
      .listByReferrer(userAndSession.user.id)
      .pipe(Effect.mapError((cause) => new ReferralRepoError({ cause })));
    const now = new Date();
    const entries = referrals.map((referral) => toReferralResponse(referral, now));

    return {
      referrals: entries,
      stats: {
        sent: entries.length,
        joined: entries.filter((entry) => entry.status === 'joined').length,
        verified: entries.filter((entry) => entry.verified).length
      }
    };
  });

export const createReferralProgram = (
  userAndSession: UserAndSession,
  input: { email: string; role: 'family' | 'service-provider' },
  context: { language: string; uiOrigin: string }
) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const userProfileRepo = yield* UserProfileRepo;
    const referralRepo = yield* ReferralRepo;
    const signupIntentRepo = yield* SignupIntentRepo;
    const mailer = yield* Mailer;

    const existingUser = yield* userRepo.findByEmail(input.email).pipe(
      Effect.map(() => true),
      Effect.catchTags({
        DBNotFoundError: () => Effect.succeed(false),
        SqlError: (cause) => Effect.fail(new ReferralRepoError({ cause }))
      })
    );
    if (existingUser) {
      return yield* Effect.fail(new ReferralEmailAlreadyMemberError());
    }

    const pending = yield* referralRepo
      .findPendingByReferrerAndEmail(userAndSession.user.id, input.email)
      .pipe(Effect.mapError((cause) => new ReferralRepoError({ cause })));
    if (pending) {
      return yield* Effect.fail(new ReferralAlreadyInvitedError());
    }

    const expiresAt = new Date(Date.now() + referralInviteTtlMs);
    // The signup intent carries the invited role (and language) into the
    // existing user-creation hook, exactly like the sign-up form does.
    yield* signupIntentRepo
      .create({ email: input.email, role: input.role, language: context.language, expiresAt })
      .pipe(Effect.mapError((cause) => new ReferralRepoError({ cause })));
    const referral = yield* referralRepo
      .create({
        referrerUserId: userAndSession.user.id,
        email: input.email,
        role: input.role,
        expiresAt
      })
      .pipe(Effect.mapError((cause) => new ReferralRepoError({ cause })));

    const profile = yield* userProfileRepo.findByUserId(userAndSession.user.id).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.succeed(null),
        SqlError: (cause) => Effect.fail(new ReferralRepoError({ cause }))
      })
    );
    const inviterName =
      [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
      userAndSession.user.email;
    const link = new URL(
      `/auth/sign-up?email=${encodeURIComponent(input.email)}&role=${input.role}`,
      context.uiOrigin
    ).toString();
    yield* mailer.sendReferralInvite({ email: input.email, inviterName, role: input.role, link });

    return toReferralResponse(
      { ...referral, referredFirstName: null, referredLastName: null, referredVerified: false },
      new Date()
    );
  });

export const listReferralsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      referral: ['read']
    })(authenticated);

    return yield* listReferralsProgram(userAndSession);
  });

export const createReferralRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, referralJsonError);
    const input = yield* validateReferralCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      referral: ['write']
    })(authenticated);

    return yield* createReferralProgram(userAndSession, input, {
      language: c.get('language') ?? 'en',
      uiOrigin: resolveUiOrigin(headers)
    });
  });

export type ReferralRouteError =
  | Effect.Effect.Error<ReturnType<typeof listReferralsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof createReferralRouteProgram>>;

const referralRouteErrorToResponse = (c: HonoContext<HonoEnv>, error: ReferralRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'ReferralRepoError':
      return c.json(
        {
          error: { code: 'REFERRAL_LOOKUP_FAILED' as const, message: 'Unable to process referral.' }
        },
        500
      );
    case 'ReferralAlreadyInvitedError':
      return c.json(
        {
          error: {
            code: 'REFERRAL_ALREADY_INVITED' as const,
            message: 'You already have a pending invite for this email.'
          }
        },
        409
      );
    case 'ReferralEmailAlreadyMemberError':
      return c.json(
        {
          error: {
            code: 'REFERRAL_EMAIL_ALREADY_MEMBER' as const,
            message: 'This person is already on Poppynz.'
          }
        },
        409
      );
    case 'MailerError':
      return c.json(
        {
          error: {
            code: 'REFERRAL_INVITE_SEND_FAILED' as const,
            message: 'The invite could not be sent. Please try again.'
          }
        },
        502
      );
    default:
      return handleNever(c, error);
  }
};

const unexpectedErrorResponse = (c: HonoContext<HonoEnv>) =>
  c.json(
    { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
    500
  );

const exitToResponse = <TData>(
  c: HonoContext<HonoEnv>,
  exit: Exit.Exit<TData, ReferralRouteError>
) =>
  Exit.match(exit, {
    onSuccess: (data) => c.json(data),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return referralRouteErrorToResponse(c, failure.value);
      }

      return unexpectedErrorResponse(c);
    }
  });

export async function listReferralsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(listReferralsRouteProgram(c.req.raw.headers));

  return exitToResponse(c, exit);
}

export async function createReferralHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(createReferralRouteProgram(c, c.req.raw.headers));

  return exitToResponse(c, exit);
}
