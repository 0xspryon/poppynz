import { Hono } from "hono";
import type { HonoEnv } from "../../../app-env";
import { createApprovalHandler } from "./approval.handler";

export const approvalRoute = new Hono<HonoEnv>().post("/", (c) =>
  createApprovalHandler(c),
);
