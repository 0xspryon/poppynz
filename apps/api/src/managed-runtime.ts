import {
  ApprovalRepoDefault,
  KycDocumentRepoDefault,
  SessionRepoDefault,
  SignupIntentRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault,
} from "@repo/db";
import { ObjectStorageLive } from "@repo/objs";
import { Layer } from "effect";
import { AuthServiceLive } from "./lib/effect-auth";
import { SignupServiceLive } from "./routes/app/auth/signup/signup.handler";

export const AppLive = Layer.mergeAll(
  SignupIntentRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault,
  SessionRepoDefault,
  ApprovalRepoDefault,
  KycDocumentRepoDefault,
  ObjectStorageLive,
  SignupServiceLive,
  AuthServiceLive,
);
