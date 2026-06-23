import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import {
  createServiceOfferedHandler,
  deleteServiceOfferedHandler,
  listServicesOfferedHandler,
  updateServiceOfferedHandler,
} from "./services-offered.handler";

export const servicesOfferedRoute = new Hono<HonoEnv>()
  .get("/", (c) => listServicesOfferedHandler(c))
  .post("/", (c) => createServiceOfferedHandler(c))
  .patch("/:id", (c) => updateServiceOfferedHandler(c))
  .delete("/:id", (c) => deleteServiceOfferedHandler(c));
