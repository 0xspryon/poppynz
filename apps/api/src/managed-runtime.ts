import {
  ApprovalRepoDefault,
  ApprovalRequestRepoDefault,
  KycDocumentRepoDefault,
  KycDocumentTypeRepoDefault,
  SessionRepoDefault,
  ServiceCatalogueRepoDefault,
  ServiceOfferedRepoDefault,
  SignupIntentRepoDefault,
  ProviderSearchOutboxRepoDefault,
  ProviderSearchRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault,
} from "@repo/db";
import { GooglePlacesLive } from "@repo/google";
import { ObjectStorageLive } from "@repo/objs";
import { ProviderSearchQueueLive } from "@repo/queue";
import { ProviderSearchIndexDefault } from "@repo/typesense";
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
  ServiceCatalogueRepoDefault,
  ServiceOfferedRepoDefault,
  ProviderSearchOutboxRepoDefault,
  ProviderSearchRepoDefault,
  GooglePlacesLive,
  ObjectStorageLive,
  ProviderSearchQueueLive,
  ProviderSearchIndexDefault,
  SigninServiceLive,
  SignupServiceLive,
  AuthServiceLive,
);

export const makeAppRuntime = (): AppRuntime => ManagedRuntime.make(AppLive) as AppRuntime;
