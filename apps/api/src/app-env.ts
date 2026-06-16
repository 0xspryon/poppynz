import type { ApprovalRepo, KycDocumentRepo, SessionRepo, SignupIntentRepo, UserProfileRepo, UserRepo } from "@repo/db";
import type { ObjectStorage, ObjectStorageFailure } from "@repo/objs";
import type { SqlError } from "@effect/sql/SqlError";
import type { ConfigError } from "effect/ConfigError";
import type { ManagedRuntime } from "effect";
import type { SigninService } from "./routes/app/auth/signin/signin.handler";
import type { SignupService } from "./routes/app/auth/signup/signup.handler";
import type { AuthService } from "./lib/effect-auth";
import { Env, Handler } from "hono";

export type AppServices =
  | SignupIntentRepo
  | SigninService
  | SignupService
  | UserProfileRepo
  | UserRepo
  | SessionRepo
  | ApprovalRepo
  | KycDocumentRepo
  | ObjectStorage
  | AuthService;

// @continue-here : evaluate the need for having errors in the runtime type?
// Isn't it expected that, I should handle all these errors
export type AppRuntime = ManagedRuntime.ManagedRuntime<
  AppServices,
  ConfigError
  | SqlError
  | ObjectStorageFailure
>;

export type BaseAppEnv = {
  Variables: {
    runtime: AppRuntime
    language: "en" | "es"
  };
};

export type HonoEnv = {
  Variables: {
    requestId: string
  }& BaseAppEnv['Variables']
}
export type HonoContext<T extends Env> = Parameters<Handler<T>>[0]
