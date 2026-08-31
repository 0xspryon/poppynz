import type { Seed } from '../types';
import { adminUsers } from './0000_admin_users';
import { kycDocumentTypes } from './0001_kyc_document_types';
import { serviceCatalogue } from './0002_service_catalogue';
import { tcDocuments } from './0003_tc_documents';
import { credibledCheckTypesSeed } from './0004_credibled_check_types';
import { credibledPricing } from './0005_credibled_pricing';
import { vscBacksSafetyVerification } from './0006_vsc_backs_safety_verification';
import { credibledDefaultPrice } from './0007_credibled_default_price';
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
  tcDocuments,
  credibledCheckTypesSeed,
  credibledPricing,
  vscBacksSafetyVerification,
  credibledDefaultPrice
  // <seed:new-entries> — `bun run seed:new` inserts above; keep this marker.
];
