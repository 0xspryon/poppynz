import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import { lookupGooglePlaceHandler } from "./geocoding.handler";

export const geocodingRoute = new Hono<HonoEnv>()
  .get("/google-place", (c) => lookupGooglePlaceHandler(c));
