import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** Isolated, in-memory PostgreSQL. Never reads env or connects to a remote DB.
 * Only pg_trgm's search indexes are omitted: PGlite does not bundle that extension.
 * Every business table/function/trigger/policy and migration runs unchanged.
 */
export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  `);
  const dir = path.join(process.cwd(), "supabase/migrations");
  for (const file of (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = (await readFile(path.join(dir, file), "utf8"))
      .replace(/create extension if not exists pg_trgm;/g, "")
      .replace(/^create index .*gin_trgm_ops.*;$/gm, "");
    try {
      await db.exec(sql);
    } catch (error) {
      await db.close();
      throw new Error(
        `Migration ${file}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return db;
}
