import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import { createApprovalRequestHandler } from "./approval-requests.handler";

export const approvalRequestsRoute = new Hono<HonoEnv>()
  .post("/", (c) => createApprovalRequestHandler(c));
