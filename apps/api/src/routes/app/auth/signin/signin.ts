import { Hono } from "hono";
import type { HonoEnv } from "../../../../app-env";
import { signinHandler } from "./signin.handler";
import { signinValidator } from "./signin.validator";

export const signinRoute = new Hono<HonoEnv>().post("/sign-in", signinValidator, (c) => {
  const body = c.req.valid("json");

  return signinHandler(c, body);
});
