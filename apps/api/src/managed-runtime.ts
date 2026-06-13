import { SignupIntentRepoDefault } from "@repo/db";
import { Layer } from "effect";
import { SignupServiceLive } from "./routes/app/auth/signup/signup.handler";

export const AppLive = Layer.mergeAll(
  SignupIntentRepoDefault,
  SignupServiceLive,
);
