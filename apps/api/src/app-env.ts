import type {
  ApprovalRepo,
  ApprovalRequestRepo,
  KycDocumentRepo,
  KycDocumentTypeRepo,
  ServiceOfferedRepo,
  SessionRepo,
  SignupIntentRepo,
  UserProfileRepo,
  UserRepo,
} from "@repo/db";
import type { ObjectStorage } from "@repo/objs";
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
  | ApprovalRequestRepo
  | KycDocumentRepo
  | KycDocumentTypeRepo
  | ServiceOfferedRepo
  | ObjectStorage
  | AuthService;

export type AppRuntime = ManagedRuntime.ManagedRuntime<
  AppServices,
  never
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
