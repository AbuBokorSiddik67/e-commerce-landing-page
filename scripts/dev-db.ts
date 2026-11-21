import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";

/**
 * Local development/test PostgreSQL server. Production uses an external
 * PostgreSQL instance via DATABASE_URL; this script is never used in prod.
 */
async function main() {
  const dataDir = path.resolve(process.cwd(), ".postgres-data");
  const port = Number(process.env.PG_PORT ?? 55432);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PG_PORT must be between 1024 and 65535");
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "landiq",
    password: "landiq_dev_password",
    port,
    persistent: true,
    autoRehydrateSymlinks: true,
    // The host's C locale can otherwise create SQL_ASCII databases, which are
    // unsuitable for Bengali and other Unicode storefront data.
    initdbFlags: ["--encoding=UTF8"],
    // Development-only credentials must never be exposed on the network.
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
  });

  const fs = await import("node:fs/promises");
  const initialized = await fs
    .access(path.join(dataDir, "PG_VERSION"))
    .then(() => true)
    .catch(() => false);
  if (!initialized) await pg.initialise();

  await pg.start();
  try {
    const client = pg.getPgClient("postgres", "127.0.0.1");
    try {
      await client.connect();
      const identity = await client.query<{ directory: string; username: string; host: string; port: number; encoding: string }>(`
        SELECT current_setting('data_directory') AS directory, current_user::text AS username,
          host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('server_encoding') AS encoding
      `);
      const actual = identity.rows[0];
      if (!actual || await fs.realpath(actual.directory) !== await fs.realpath(dataDir)
        || actual.username !== "landiq" || actual.host !== "127.0.0.1" || actual.port !== port) {
        throw new Error("Refusing to initialize databases: PostgreSQL identity mismatch");
      }
      if (actual.encoding !== "UTF8") console.warn("Existing development cluster is not UTF8; back it up and migrate it before storing Unicode data.");
      for (const name of ["landiq", "landiq_test"]) {
        const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
        if (!exists.rowCount) await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
      }
    } finally { await client.end(); }
  } catch (error) {
    await pg.stop();
    throw error;
  }
  console.log(`PostgreSQL ready on port ${port} (landiq, landiq_test)`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
