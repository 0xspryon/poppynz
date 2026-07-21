// Applies all pending seeds, one transaction per seed, and records each in
// drizzle_app_db.__seeds_applied — the seeding counterpart of `db:migrate`.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@repo/db/schema";
import { selectPending } from "./runner";
import { seeds } from "./seeds/index";
import { appliedSeedNames, ensureTrackingTable, recordApplied } from "./tracking";

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "" });
const db = drizzle(pool, { schema });

try {
  await ensureTrackingTable(db);
  const applied = await appliedSeedNames(db);
  const pending = selectPending(seeds, applied);

  for (const seed of pending) {
    await db.transaction(async (tx) => {
      await seed.run(tx);
      await recordApplied(tx, seed.name);
    });
    console.log(`seed applied: ${seed.name}`);
  }

  console.log(
    pending.length === 0
      ? `No pending seeds (${applied.size} already applied)`
      : `Applied ${pending.length} seed(s)`,
  );
} finally {
  await pool.end();
}
