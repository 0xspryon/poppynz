import { Hono } from "hono";
import type { HonoEnv } from "../../../app-env";
import { getFamilyOnboardingHandler, getOnboardingHandler, getOnboardingHistoryHandler } from "./onboarding.handler";

export const onboardingRoute = new Hono<HonoEnv>()
  .get("/history", (c) => getOnboardingHistoryHandler(c))
  .get("/family", (c) => getFamilyOnboardingHandler(c))
  .get("/", (c) => getOnboardingHandler(c));
