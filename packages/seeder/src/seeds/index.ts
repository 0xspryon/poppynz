import type { Seed } from "../types";
import { adminUsers } from "./0000_admin_users";
import { kycDocumentTypes } from "./0001_kyc_document_types";
import { serviceCatalogue } from "./0002_service_catalogue";
// <seed:new-imports> — `bun run seed:new` inserts above; keep this marker.

/**
 * Append-only, ordered registry. Scaffold a new seed with
 * `bun run seed:new <description>` — it creates `src/seeds/NNNN_description.ts`
 * and registers it here. Applied seeds are tracked per-database and never
 * re-run, so never rename or delete one that has run anywhere.
 */
export const seeds: ReadonlyArray<Seed> = [
  adminUsers,
  kycDocumentTypes,
  serviceCatalogue,
  // <seed:new-entries> — `bun run seed:new` inserts above; keep this marker.
];
