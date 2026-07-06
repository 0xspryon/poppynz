import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import { getProviderHandler, searchProvidersHandler } from "./providers.handler";

export const providersRoute = new Hono<HonoEnv>()
  .get("/search", (c) => searchProvidersHandler(c))
  .get("/:userId", (c) => getProviderHandler(c));
