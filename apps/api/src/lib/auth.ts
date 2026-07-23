import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { organization } from "better-auth/plugins";
import { i18n } from "@better-auth/i18n";
import { openAPI } from "better-auth/plugins";
import { roles, appAc } from './auth-roles'
import { resolveUiOrigin, trustedUiOrigins } from './ui-origin'
import {
  db,
  ProviderSearchOutboxRepoDefault,
  ReferralRepo,
  ReferralRepoDefault,
  SignupIntentRepo,
  SignupIntentRepoDefault,
  UserProfileRepo,
  UserProfileRepoDefault,
} from "@repo/db";
import { ProviderSearchQueueLive } from "@repo/queue";
import { Cause, Data, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";
import { scheduleProviderSearchReconcile } from "./provider-search-jobs";

export class SignupHookDbError extends Data.TaggedError("SignupHookDbError")<{
  cause: unknown;
}> { }

const AuthHookLive = Layer.mergeAll(
  SignupIntentRepoDefault,
  UserProfileRepoDefault,
  ReferralRepoDefault,
  ProviderSearchOutboxRepoDefault,
  ProviderSearchQueueLive,
);
const authHookRuntime = ManagedRuntime.make(AuthHookLive);

export const applySignupIntentToUserEffect = <TUser extends { email: string }>(user: TUser) =>
  Effect.gen(function*() {
    const signupIntentRepo = yield* SignupIntentRepo;
    const intent = yield* signupIntentRepo
      .findValidByEmail(user.email)
      .pipe(Effect.mapError((cause) => new SignupHookDbError({ cause })));

    if (!intent) {
      return user;
    }

    return {
      ...user,
      role: intent.role,
    };
  });

export const createProfileAndConsumeSignupIntentEffect = (user: { id: string; email: string }) =>
  Effect.gen(function*() {
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
        typeof failure.value === "object" &&
        failure.value !== null &&
        "_tag" in failure.value
        ? failure.value._tag
        : "UnexpectedHookDefect"
      ) {
        case "SignupHookDbError":
          // TODO: log this failure to Sentry once error reporting is wired.
          return fallback;
        case "UnexpectedHookDefect":
          // TODO: log this defect to Sentry once error reporting is wired.
          return fallback;
        default:
          // TODO: log this unexpected hook error to Sentry once error reporting is wired.
          return fallback;
      }
    },
  });
};

export const auth = betterAuth({
  appName: "Poppynz",
  // Allows magic-link callback URLs to point back at the calling UI app.
  trustedOrigins: [...trustedUiOrigins],
  emailAndPassword: {
    enabled: false,
  },
  plugins: [
    admin({
      ac: appAc,
      roles,
    }),
    openAPI(),
    apiKey(),
    organization(),
    i18n({
      translations: {
        fr: {
          USER_NOT_FOUND: "Utilisateur non trouvé",
          INVALID_EMAIL_OR_PASSWORD: "Email ou mot de passe invalide",
          INVALID_PASSWORD: "Mot de passe invalide",
        },
        de: {
          USER_NOT_FOUND: "Benutzer nicht gefunden",
          INVALID_EMAIL_OR_PASSWORD: "Ungültige E-Mail oder Passwort",
          INVALID_PASSWORD: "Ungültiges Passwort",
        },
      },
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
        console.log(`Magic link for ${email}: ${link.toString()}`);
      },
    })
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: await runSignupHookEffect(authHookRuntime.runPromiseExit(applySignupIntentToUserEffect(user)), user),
        }),
        after: async (user) => {
          await runSignupHookEffect(authHookRuntime.runPromiseExit(createProfileAndConsumeSignupIntentEffect(user)), undefined);
        },
      },
      update: {
        // Fires for better-auth admin mutations (ban/unban, role changes).
        // A ban hides the provider instantly via the search path's DB gate;
        // the reconcile keeps the index itself in step — critically on UNBAN,
        // where the provider's document must be re-created to be searchable
        // again (lazy repair deletes it while they are banned).
        after: async (user) => {
          const updated = user as { id: string; role?: string | null };
          if (updated.role === "service-provider") {
            await authHookRuntime.runPromise(scheduleProviderSearchReconcile(updated.id));
          }
        },
      },
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg", // or "mysql", "sqlite"
  }),
});
