import { Hono } from "hono";
import type { HonoEnv } from "../../../app-env";
import { createReferralHandler, listReferralsHandler } from "./referrals.handler";

export const referralsRoute = new Hono<HonoEnv>()
  .get("/", (c) => listReferralsHandler(c))
  .post("/", (c) => createReferralHandler(c));
