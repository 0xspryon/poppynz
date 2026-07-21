import { Hono } from "hono";
import type { HonoEnv } from "../../../app-env";
import { getOnboardingHandler, getOnboardingHistoryHandler } from "./onboarding.handler";

export const onboardingRoute = new Hono<HonoEnv>()
  .get("/history", (c) => getOnboardingHistoryHandler(c))
  .get("/", (c) => getOnboardingHandler(c));
