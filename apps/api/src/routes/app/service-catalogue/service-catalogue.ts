import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import { listLiveServiceCatalogueHandler } from "./service-catalogue.handler";

export const serviceCatalogueRoute = new Hono<HonoEnv>()
  .get("/", (c) => listLiveServiceCatalogueHandler(c));
