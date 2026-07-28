import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import {
  createTcDocumentHandler,
  createTcDraftHandler,
  deleteTcDocumentHandler,
  getAdminTcHandler,
  listAdminTcsHandler,
  publishTcDraftHandler,
  updateTcDocumentHandler,
  updateTcDraftHandler,
} from "../tcs/tcs.handler";

export const adminTcsRoute = new Hono<HonoEnv>()
  .get("/", (c) => listAdminTcsHandler(c))
  .post("/", (c) => createTcDocumentHandler(c))
  .get("/:id", (c) => getAdminTcHandler(c))
  .patch("/:id", (c) => updateTcDocumentHandler(c))
  .delete("/:id", (c) => deleteTcDocumentHandler(c))
  .post("/:id/draft", (c) => createTcDraftHandler(c))
  .patch("/:id/draft", (c) => updateTcDraftHandler(c))
  .post("/:id/publish", (c) => publishTcDraftHandler(c));
