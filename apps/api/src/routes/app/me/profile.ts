import { Hono } from "hono";
import { HonoEnv } from "../../../app-env";
import { getProfileHandler, updateProfileHandler } from "./profile.handler";
import { profileUpdateValidator } from "./profile.validator";

export const profileRoute = new Hono<HonoEnv>()
  .get("/", (c) => getProfileHandler(c))
  .patch("/", profileUpdateValidator, (c) => {
    const body = c.req.valid("json");

    return updateProfileHandler(c, body);
  });
