import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Config, Layer, Data, Redacted } from "effect";
import * as schema from "./schema";

const PgLive = PgClient.layerConfig({
  url: Config.string("DATABASE_URL").pipe(Config.map(Redacted.make)),
});

export const DrizzleLive = PgDrizzle.layerWithConfig({ schema } as never).pipe(
  Layer.provide(PgLive),
);

export class DBNotFoundError extends Data.TaggedError("DBNotFoundError")<{ entity: string, value: string }>{}