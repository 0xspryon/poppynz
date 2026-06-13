import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";
import { magicLink } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { organization } from "better-auth/plugins";
import { i18n } from "@better-auth/i18n";
import { openAPI } from "better-auth/plugins";
import {
  db,
  SignupIntentRepo,
  SignupIntentRepoDefault,
  UserProfileRepo,
  UserProfileRepoDefault,
} from "@repo/db";
import { Cause, Data, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";

export class SignupHookDbError extends Data.TaggedError("SignupHookDbError")<{
  cause: unknown;
}> {}

const AuthHookLive = Layer.mergeAll(SignupIntentRepoDefault, UserProfileRepoDefault);
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
      role: intent.role,
    };
  });

export const createProfileAndConsumeSignupIntentEffect = (user: { id: string; email: string }) =>
  Effect.gen(function* () {
    const signupIntentRepo = yield* SignupIntentRepo;
    const userProfileRepo = yield* UserProfileRepo;
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
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    admin(),
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
    phoneNumber({
      sendOTP: ({ phoneNumber, code }, ctx) => {
          // Implement sending OTP code via SMS
      },
      signUpOnVerification: {
        getTempEmail: (phoneNumber) => {
          return `${phoneNumber}@my-site.com`
        },
        //optionally, you can also pass `getTempName` function to generate a temporary name for the user
        getTempName: (phoneNumber) => {
          return phoneNumber //by default, it will use the phone number as the name
        }
      }
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        console.log(`Magic link for ${email}: ${url}`);
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
    },
  },
  database: drizzleAdapter(db, {
      provider: "pg", // or "mysql", "sqlite"
  }),
});
