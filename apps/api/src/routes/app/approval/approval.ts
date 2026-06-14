import { Hono } from "hono";
import type { HonoEnv } from "../../../app-env";
import { createApprovalHandler } from "./approval.handler";
import { approvalValidator } from "./approval.validator";

export const approvalRoute = new Hono<HonoEnv>().post("/", approvalValidator, (c) => {
  const body = c.req.valid("json");

  return createApprovalHandler(c, body);
});
