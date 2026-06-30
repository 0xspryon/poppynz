import { Hono } from "hono";
import { HonoEnv } from "../../../app-env";
import { getProfileHandler, updateProfileHandler, updateProfileLocationHandler } from "./profile.handler";

export const profileRoute = new Hono<HonoEnv>()
  .patch("/location", (c) => updateProfileLocationHandler(c))
  .get("/", (c) => getProfileHandler(c))
  .patch("/", (c) => updateProfileHandler(c));
