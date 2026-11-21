import "dotenv/config";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

/**
 * Read-only preflight for the documented NEW local embedded development DB.
 * It is not a general-purpose safety check for real installations. Run before
 * migration/seed; a database containing any application objects must fail.
 */
async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Set DATABASE_URL in .env first");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("DATABASE_URL is invalid"); }
  const port = Number(process.env.PG_PORT ?? 55432);
  if (!Number.isInteger(port) || port < 1024 || port > 65535
    || !["postgresql:", "postgres:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || Number(url.port || 5432) !== port || url.username !== "landiq" || url.pathname !== "/landiq" || url.hash
    || [...url.searchParams].some(([key, value]) => key !== "schema" || value !== "public")) {
    throw new Error("Refusing: DATABASE_URL must target the local embedded landiq database and configured PG_PORT");
  }

  const directory = path.resolve(process.cwd(), ".postgres-data");
  let expected: string;
  let pidFile: string[];
  try {
    expected = await realpath(directory);
    pidFile = (await readFile(path.join(directory, "postmaster.pid"), "utf8")).split("\n");
    if (await realpath(pidFile[1]) !== expected) throw new Error();
  } catch { throw new Error("Start the repository's own local PostgreSQL with npm run db:dev first"); }
  const pid = Number(pidFile[0]);
  if (!Number.isInteger(pid) || pid < 2 || Number(pidFile[3]) !== port || pidFile[5] !== "127.0.0.1") {
    throw new Error("Refusing: the embedded PostgreSQL process identity does not match");
  }
  try { process.kill(pid, 0); } catch { throw new Error("The embedded PostgreSQL process is not running"); }

  const client = new Client({ connectionString: raw, connectionTimeoutMillis: 5000 });
  try {
    try { await client.connect(); } catch { throw new Error("Could not connect to the embedded local database"); }
    await client.query("BEGIN READ ONLY");
    const result = await client.query<{
      directory: string; database: string; username: string; host: string; port: number; schema: string; encoding: string;
      relations: string; types: string; functions: string; other_schemas: string;
    }>(`
      SELECT current_setting('data_directory') AS directory, current_database()::text AS database,
        current_user::text AS username, host(inet_server_addr()) AS host, inet_server_port() AS port,
        current_schema()::text AS schema, current_setting('server_encoding') AS encoding,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) AS relations,
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typtype IN ('e', 'c', 'd')) AS types,
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS functions,
        (SELECT count(*) FROM pg_namespace WHERE nspname <> 'public' AND nspname <> 'information_schema'
          AND nspname NOT LIKE 'pg\\_%' ESCAPE '\\') AS other_schemas
    `);
    const actual = result.rows[0];
    if (!actual || await realpath(actual.directory) !== expected || actual.database !== "landiq"
      || actual.username !== "landiq" || actual.host !== "127.0.0.1" || actual.port !== port || actual.schema !== "public") {
      throw new Error("Refusing: the connected database identity does not match the local embedded cluster");
    }
    if (actual.encoding !== "UTF8") throw new Error("Existing cluster is not UTF8; use a fresh cluster or plan a separate data migration");
    if ([actual.relations, actual.types, actual.functions, actual.other_schemas].some((count) => Number(count) !== 0)) {
      throw new Error("Database is not empty; do not run the new-installation migration or seed instructions");
    }
    console.log(`Verified empty UTF8 local development database: ${actual.database}, ${actual.host}:${actual.port}, ${expected}`);
  } finally {
    // Closing a connection rolls back the read-only transaction even on error.
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local database check failed");
  process.exitCode = 1;
});
