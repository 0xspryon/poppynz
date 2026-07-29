import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import { scheduleFamilySearchReindexHandler } from "./family-search.handler";

export const adminFamilySearchRoute = new Hono<HonoEnv>()
  .post("/reindex", (c) => scheduleFamilySearchReindexHandler(c));
