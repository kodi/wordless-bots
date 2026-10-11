import { sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

export type Db = DrizzleD1Database;

/** Public reads go to the nearest read replica (docs/ARCHITECTURE.md §7.0). */
export function readDb(env: Env): Db {
  return drizzle(asDatabase(env.DB.withSession("first-unconstrained")));
}

export function writeDb(env: Env): Db {
  return drizzle(env.DB);
}

/**
 * drizzle-orm/d1 is typed against D1Database but only calls `prepare()` and `batch()`,
 * which a session also has. Don't use drizzle's migrator on a session (it needs `exec()`).
 */
function asDatabase(session: D1DatabaseSession): D1Database {
  return session as unknown as D1Database;
}

export async function pingDb(db: Db): Promise<boolean> {
  const row = await db.get<{ one: number }>(sql`SELECT 1 AS one`);
  return row?.one === 1;
}
