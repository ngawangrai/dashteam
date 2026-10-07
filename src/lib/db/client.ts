import "server-only";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env/server";
import * as schema from "./schema";

export type JwtClaims = { sub: string } & Record<string, unknown>;

const globalForDb = globalThis as unknown as { dashteamSql?: postgres.Sql };

// prepare: false because Supabase's transaction pooler does not support prepared statements.
const client = globalForDb.dashteamSql ?? postgres(serverEnv.DATABASE_URL, { prepare: false, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.dashteamSql = client;

const baseDb = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof baseDb.transaction>[0]>[0];

/**
 * Runs queries as the signed-in person so Postgres RLS applies, exactly as it would
 * through the Supabase API. App code reads and writes only through this.
 */
export function asUser<T>(claims: JwtClaims, run: (tx: Tx) => Promise<T>): Promise<T> {
  return baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
        set_config('request.jwt.claim.sub', ${claims.sub}, true),
        set_config('role', 'authenticated', true)
    `);
    return run(tx);
  });
}

/**
 * Runs on the server's own connection, with no signed-in person and so no RLS. Only for work no
 * person starts: the daily filing reminder job (behind its secret). Everything else uses asUser.
 */
export function asSystem<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  return baseDb.transaction(run);
}
