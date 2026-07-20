import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import {
  createServiceCatalogueItemHandler,
  deleteServiceCatalogueItemHandler,
  listAdminServiceCatalogueHandler,
  updateServiceCatalogueItemHandler,
} from "../service-catalogue/service-catalogue.handler";

export const adminServiceCatalogueRoute = new Hono<HonoEnv>()
  .get("/", (c) => listAdminServiceCatalogueHandler(c))
  .post("/", (c) => createServiceCatalogueItemHandler(c))
  .patch("/:id", (c) => updateServiceCatalogueItemHandler(c))
  .delete("/:id", (c) => deleteServiceCatalogueItemHandler(c));
