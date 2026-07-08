import type {
  ApprovalRepo,
  ApprovalRequestRepo,
  KycDocumentRepo,
  KycDocumentTypeRepo,
  ServiceOfferedRepo,
  SessionRepo,
  SignupIntentRepo,
  ProviderSearchOutboxRepo,
  ProviderSearchRepo,
  UserProfileRepo,
  UserRepo,
} from "@repo/db";
import type { GooglePlaces } from "@repo/google";
import type { ObjectStorage } from "@repo/objs";
import type { ProviderSearchQueue } from "@repo/queue";
import type { ProviderSearchIndex } from "@repo/typesense";
import type { ManagedRuntime } from "effect";
import type { SigninService } from "./routes/app/auth/signin/signin.handler";
import type { SignupService } from "./routes/app/auth/signup/signup.handler";
import type { AuthService } from "./lib/effect-auth";
import type { Env, Handler } from "hono";

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
  | ProviderSearchOutboxRepo
  | ProviderSearchRepo
  | GooglePlaces
  | ObjectStorage
  | ProviderSearchQueue
  | ProviderSearchIndex
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
