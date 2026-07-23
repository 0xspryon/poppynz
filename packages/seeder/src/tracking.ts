import { sql } from "drizzle-orm";
import type { SeederDb } from "./types";

// Same schema drizzle uses for its migration journal, so all bookkeeping
// tables live together.
export const ensureTrackingTable = async (db: SeederDb): Promise<void> => {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle_app_db"`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "drizzle_app_db"."__seeds_applied" (
      "name" text PRIMARY KEY,
      "applied_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
};

export const appliedSeedNames = async (db: SeederDb): Promise<ReadonlySet<string>> => {
  const result = await db.execute(sql`SELECT "name" FROM "drizzle_app_db"."__seeds_applied"`);
  return new Set(result.rows.map((row) => String(row.name)));
};

export const recordApplied = async (db: SeederDb, name: string): Promise<void> => {
  await db.execute(sql`INSERT INTO "drizzle_app_db"."__seeds_applied" ("name") VALUES (${name})`);
};
