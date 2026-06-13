import { Hono } from "hono";
import type { HonoEnv } from "../../../../app-env";
import { signupHandler } from "./signup.handler";
import { signupValidator } from "./signup.validator";

export const signupRoute = new Hono<HonoEnv>()
.post(
  "/sign-up",
  signupValidator,
  (c) => {
    const body = c.req.valid('json')
    return signupHandler(c, body)
  },
);
