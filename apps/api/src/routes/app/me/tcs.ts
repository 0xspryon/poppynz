import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import { acceptTcsHandler, listPendingTcsHandler } from "../tcs/tcs.handler";

export const meTcsRoute = new Hono<HonoEnv>()
  .get("/pending", (c) => listPendingTcsHandler(c))
  .post("/accept", (c) => acceptTcsHandler(c));
