import { Hono } from "hono";
import type { HonoEnv } from "@/api/app-env";
import { updateAdminKycDocumentHandler } from "../kyc-docs/kyc-docs.handler";

export const adminKycDocsRoute = new Hono<HonoEnv>()
  .patch("/:id", (c) => updateAdminKycDocumentHandler(c));
