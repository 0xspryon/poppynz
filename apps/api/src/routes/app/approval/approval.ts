import { Hono } from "hono";
import type { HonoEnv } from "../../../app-env";
import { createApprovalHandler, revokeApprovalHandler } from "./approval.handler";

export const approvalRoute = new Hono<HonoEnv>()
  .post("/:id/revoke", (c) => revokeApprovalHandler(c))
  .post("/", (c) => createApprovalHandler(c));
