import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import { createUploadPresignHandler } from "./upload.handler";
import { uploadPresignValidator } from "./upload.validator";

export const uploadRoute = new Hono<HonoEnv>().post("/presigned-url", uploadPresignValidator, (c) => {
  const body = c.req.valid("json");

  return createUploadPresignHandler(c, body);
});
