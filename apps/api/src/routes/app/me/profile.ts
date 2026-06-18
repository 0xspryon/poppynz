import { Hono } from "hono";
import { HonoEnv } from "../../../app-env";
import { getProfileHandler, updateProfileHandler } from "./profile.handler";

export const profileRoute = new Hono<HonoEnv>()
  .get("/", (c) => getProfileHandler(c))
  .patch("/", (c) => updateProfileHandler(c));
