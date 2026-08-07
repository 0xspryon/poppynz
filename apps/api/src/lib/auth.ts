import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { admin } from 'better-auth/plugins';
import { apiKey } from '@better-auth/api-key';
import { organization } from 'better-auth/plugins';
import { i18n } from '@better-auth/i18n';
import { openAPI } from 'better-auth/plugins';
import { roles, appAc } from './auth-roles';
import { resolveUiOrigin, trustedUiOrigins } from './ui-origin';
import {
  db,
  FamilySearchOutboxRepoDefault,
  ProviderSearchOutboxRepoDefault,
  ReferralRepo,
  ReferralRepoDefault,
  SignupIntentRepo,
  SignupIntentRepoDefault,
  UserProfileRepo,
  UserProfileRepoDefault
} from '@repo/db';
import { FamilySearchQueueLive, ProviderSearchQueueLive } from '@repo/queue';
import { Cause, Data, Effect, Exit, Layer, ManagedRuntime, Option } from 'effect';
import { Mailer, MailerLive, sendMailBestEffort } from './mailer';
import { scheduleFamilySearchReconcile } from './family-search-jobs';
import { scheduleProviderSearchReconcile } from './provider-search-jobs';

export class SignupHookDbError extends Data.TaggedError('SignupHookDbError')<{
  cause: unknown;
}> {}

const AuthHookLive = Layer.mergeAll(
  SignupIntentRepoDefault,
  UserProfileRepoDefault,
  ReferralRepoDefault,
  ProviderSearchOutboxRepoDefault,
  ProviderSearchQueueLive,
  FamilySearchOutboxRepoDefault,
  FamilySearchQueueLive,
  MailerLive
);
const authHookRuntime = ManagedRuntime.make(AuthHookLive);

export const applySignupIntentToUserEffect = <TUser extends { email: string }>(user: TUser) =>
  Effect.gen(function* () {
    const signupIntentRepo = yield* SignupIntentRepo;
    const intent = yield* signupIntentRepo
      .findValidByEmail(user.email)
      .pipe(Effect.mapError((cause) => new SignupHookDbError({ cause })));

    if (!intent) {
      return user;
    }

    return {
      ...user,
      role: intent.role
    };
  });

export const createProfileAndConsumeSignupIntentEffect = (user: { id: string; email: string }) =>
  Effect.gen(function* () {
    const signupIntentRepo = yield* SignupIntentRepo;
    const userProfileRepo = yield* UserProfileRepo;
    const referralRepo = yield* ReferralRepo;

    // Any pending referral invites for this email are now "joined".
    yield* referralRepo
      .markJoinedByEmail(user.email, user.id)
      .pipe(Effect.mapError((cause) => new SignupHookDbError({ cause })));
    const intent = yield* signupIntentRepo
      .findValidByEmail(user.email)
      .pipe(Effect.mapError((cause) => new SignupHookDbError({ cause })));

    if (!intent) {
      return;
    }

    yield* userProfileRepo
      .create({ userId: user.id, language: intent.language })
      .pipe(Effect.mapError((cause) => new SignupHookDbError({ cause })));

    yield* signupIntentRepo
      .consumeByEmail(user.email)
      .pipe(Effect.mapError((cause) => new SignupHookDbError({ cause })));
  });

const runSignupHookEffect = async <A>(exitPromise: Promise<Exit.Exit<A, unknown>>, fallback: A) => {
  const exit = await exitPromise;

  return Exit.match(exit, {
    onSuccess: (value) => value,
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      switch (
        Option.isSome(failure) &&
        typeof failure.value === 'object' &&
        failure.value !== null &&
        '_tag' in failure.value
          ? failure.value._tag
          : 'UnexpectedHookDefect'
      ) {
        case 'SignupHookDbError':
          // TODO: log this failure to Sentry once error reporting is wired.
          return fallback;
        case 'UnexpectedHookDefect':
          // TODO: log this defect to Sentry once error reporting is wired.
          return fallback;
        default:
          // TODO: log this unexpected hook error to Sentry once error reporting is wired.
          return fallback;
      }
    }
  });
};

/** Welcome mail with role-specific next steps, sent once when the user record
 * is created (i.e. on the first magic-link verification). Links are rebased
 * onto the UI origin that initiated the request, like magic links. Best-effort:
 * a mail failure must never fail account creation. */
export const sendWelcomeMailEffect = (
  user: { email: string; name?: string | null; role?: string | null },
  headers?: Headers
) => {
  const origin = resolveUiOrigin(headers ?? new Headers());
  const link = (path: string) => new URL(path, origin).toString();
  const name = user.name || null;

  if (user.role === 'family') {
    return sendMailBestEffort(
      'family welcome',
      Effect.flatMap(Mailer, (mailer) =>
        mailer.sendFamilyWelcome({
          email: user.email,
          name,
          profileLink: link('/family/profile'),
          needsLink: link('/family/needs'),
          findLink: link('/family/find')
        })
      )
    );
  }

  if (user.role === 'service-provider') {
    return sendMailBestEffort(
      'provider welcome',
      Effect.flatMap(Mailer, (mailer) =>
        mailer.sendProviderWelcome({
          email: user.email,
          name,
          profileLink: link('/service-provider/profile'),
          documentsLink: link('/service-provider/documents'),
          servicesLink: link('/service-provider/services'),
          approvalLink: link('/service-provider/approval'),
          findLink: link('/service-provider/find')
        })
      )
    );
  }

  // Admins (and any future roles) get no onboarding mail.
  return Effect.void as Effect.Effect<void, never, Mailer>;
};

/** Mails a user when an admin bans or unbans them. Keyed off the admin
 * endpoint paths so the lazy `banExpires` auto-unban (which also flips
 * `banned` back to false, from whatever endpoint touched the session) never
 * emails anyone. Best-effort: a mail failure must not fail the admin call. */
export const notifyBanStatusChangeEffect = (
  user: { email: string; name?: string | null; banReason?: string | null },
  endpointPath: string | undefined,
  headers?: Headers
) => {
  if (endpointPath !== '/admin/ban-user' && endpointPath !== '/admin/unban-user') {
    return Effect.void as Effect.Effect<void, never, Mailer>;
  }

  const name = user.name || null;
  return endpointPath === '/admin/ban-user'
    ? sendMailBestEffort(
        'account banned',
        Effect.flatMap(Mailer, (mailer) =>
          mailer.sendAccountBanned({ email: user.email, name, reason: user.banReason ?? null })
        )
      )
    : sendMailBestEffort(
        'account unbanned',
        Effect.flatMap(Mailer, (mailer) =>
          mailer.sendAccountUnbanned({
            email: user.email,
            name,
            link: new URL('/auth/sign-in', resolveUiOrigin(headers ?? new Headers())).toString()
          })
        )
      );
};

export const auth = betterAuth({
  appName: 'Poppynz',
  // Allows magic-link callback URLs to point back at the calling UI app.
  trustedOrigins: [...trustedUiOrigins],
  emailAndPassword: {
    enabled: false
  },
  plugins: [
    admin({
      ac: appAc,
      roles
    }),
    openAPI(),
    apiKey(),
    organization(),
    i18n({
      translations: {
        fr: {
          USER_NOT_FOUND: 'Utilisateur non trouvé',
          INVALID_EMAIL_OR_PASSWORD: 'Email ou mot de passe invalide',
          INVALID_PASSWORD: 'Mot de passe invalide'
        },
        de: {
          USER_NOT_FOUND: 'Benutzer nicht gefunden',
          INVALID_EMAIL_OR_PASSWORD: 'Ungültige E-Mail oder Passwort',
          INVALID_PASSWORD: 'Ungültiges Passwort'
        }
      }
    }),
    magicLink({
      sendMagicLink: async ({ email, url }, ctx) => {
        // Rebase the link onto the UI origin that initiated the request —
        // every UI proxies /api/* to this server (vite in dev, Traefik in
        // prod) — rather than the static BETTER_AUTH_URL host. Untrusted or
        // absent origins fall back to the first trusted origin.
        const generated = new URL(url);
        const uiOrigin = resolveUiOrigin(ctx?.headers ?? new Headers());
        const link = new URL(`${generated.pathname}${generated.search}`, uiOrigin);
        // Failures propagate so better-auth reports the send error instead of
        // silently succeeding while no mail goes out.
        await authHookRuntime.runPromise(
          Effect.flatMap(Mailer, (mailer) => mailer.sendMagicLink({ email, link: link.toString() }))
        );
      }
    })
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: await runSignupHookEffect(
            authHookRuntime.runPromiseExit(applySignupIntentToUserEffect(user)),
            user
          )
        }),
        after: async (user, ctx) => {
          await runSignupHookEffect(
            authHookRuntime.runPromiseExit(createProfileAndConsumeSignupIntentEffect(user)),
            undefined
          );
          // The role was applied from the signup intent in the before hook, so
          // the created row already carries it.
          const created = user as {
            id: string;
            email: string;
            name?: string | null;
            role?: string | null;
          };
          await authHookRuntime.runPromise(
            sendWelcomeMailEffect(created, ctx?.headers ?? undefined)
          );
        }
      },
      update: {
        // Fires for better-auth admin mutations (ban/unban, role changes).
        // A ban hides the provider instantly via the search path's DB gate;
        // the reconcile keeps the index itself in step — critically on UNBAN,
        // where the provider's document must be re-created to be searchable
        // again (lazy repair deletes it while they are banned).
        after: async (user, ctx) => {
          const updated = user as {
            id: string;
            email: string;
            name?: string | null;
            role?: string | null;
            banReason?: string | null;
          };
          await authHookRuntime.runPromise(
            notifyBanStatusChangeEffect(updated, ctx?.path, ctx?.headers ?? undefined)
          );
          if (updated.role === 'service-provider') {
            await authHookRuntime.runPromise(scheduleProviderSearchReconcile(updated.id));
          }
          if (updated.role === 'family') {
            await authHookRuntime.runPromise(scheduleFamilySearchReconcile(updated.id));
          }
        }
      }
    }
  },
  database: drizzleAdapter(db, {
    provider: 'pg' // or "mysql", "sqlite"
  })
});
