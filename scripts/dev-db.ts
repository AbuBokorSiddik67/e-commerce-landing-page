import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";

/**
 * Local development/test PostgreSQL server. Production uses an external
 * PostgreSQL instance via DATABASE_URL; this script is never used in prod.
 */
async function main() {
  const dataDir = path.resolve(process.cwd(), ".postgres-data");
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "landiq",
    password: "landiq_dev_password",
    port: Number(process.env.PG_PORT ?? 55432),
    persistent: true,
    autoRehydrateSymlinks: true,
  });

  const fs = await import("node:fs/promises");
  const initialized = await fs
    .access(path.join(dataDir, "PG_VERSION"))
    .then(() => true)
    .catch(() => false);
  if (!initialized) await pg.initialise();

  await pg.start();
  for (const name of ["landiq", "landiq_test"]) {
    try {
      await pg.createDatabase(name);
    } catch (error) {
      if (!(error instanceof Error && /already exists/i.test(error.message))) throw error;
    }
  }
  console.log(`PostgreSQL ready on port ${process.env.PG_PORT ?? 55432} (landiq, landiq_test)`);

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
