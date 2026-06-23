import {
  ApprovalRepoDefault,
  ApprovalRequestRepoDefault,
  KycDocumentRepoDefault,
  KycDocumentTypeRepoDefault,
  SessionRepoDefault,
  ServiceOfferedRepoDefault,
  SignupIntentRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault,
} from "@repo/db";
import { ObjectStorageLive } from "@repo/objs";
import { Layer, ManagedRuntime } from "effect";
import type { AppRuntime } from "./app-env";
import { AuthServiceLive } from "./lib/effect-auth";
import { SigninServiceLive } from "./routes/app/auth/signin/signin.handler";
import { SignupServiceLive } from "./routes/app/auth/signup/signup.handler";

export const AppLive = Layer.mergeAll(
  SignupIntentRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault,
  SessionRepoDefault,
  ApprovalRepoDefault,
  ApprovalRequestRepoDefault,
  KycDocumentRepoDefault,
  KycDocumentTypeRepoDefault,
  ServiceOfferedRepoDefault,
  ObjectStorageLive,
  SigninServiceLive,
  SignupServiceLive,
  AuthServiceLive,
);

export const makeAppRuntime = (): AppRuntime => ManagedRuntime.make(AppLive) as AppRuntime;
