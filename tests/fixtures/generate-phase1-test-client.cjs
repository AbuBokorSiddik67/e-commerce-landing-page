/*
 * Opt-in, offline test-client generation for the disposable Phase 1 fixtures.
 * This replaces the ignored node_modules/.prisma/client with a JS-engine client
 * that REQUIRES a driver adapter. It is NOT a production client or build.
 * Restore the normal client with the project's ordinary `prisma generate` in
 * an environment where the verified native engine is available.
 *
 * Requires matching @prisma/internals and @prisma/client packages. Never reads
 * a real DATABASE_URL, connects to a database, or changes the tracked schema.
 */
const fs = require("node:fs");
const path = require("node:path");

if (process.env.LANDIQ_PHASE1_TEST_CLIENT !== "1") throw new Error("Explicit test-client opt-in is required");
if (require("@prisma/client/package.json").version !== "6.19.3" || require("@prisma/internals/package.json").version !== "6.19.3") {
  throw new Error("Test client requires matching Prisma 6.19.3 packages");
}
const { getGenerators } = require("@prisma/internals");
const root = fs.realpathSync(process.cwd());
const modules = path.join(root, "node_modules");
if (fs.realpathSync(modules) !== modules) throw new Error("Refusing a symlinked node_modules directory");
const output = path.join(modules, ".prisma", "client");
for (const candidate of [path.dirname(output), output]) {
  if (fs.existsSync(candidate) && fs.realpathSync(candidate) !== candidate) throw new Error("Refusing a symlinked test-client output");
}
const original = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const generator = /generator\s+client\s*\{\s*provider\s*=\s*"prisma-client-js"\s*\}/g;
const matches = [...original.matchAll(generator)];
if (matches.length !== 1) throw new Error("Unexpected tracked Prisma generator; manual review required");
const tmpRoot = path.join(root, "tmp");
fs.mkdirSync(tmpRoot, { recursive: true });
if (fs.realpathSync(tmpRoot) !== tmpRoot) throw new Error("Refusing a symlinked temporary directory");
const scratch = fs.mkdtempSync(path.join(tmpRoot, "phase1-test-client-"));
const schemaPath = path.join(scratch, "schema.prisma");
const testSchema = original.replace(generator, `generator client {\n  provider = "prisma-client-js"\n  engineType = "client"\n  output = ${JSON.stringify(output)}\n}`);
fs.writeFileSync(schemaPath, testSchema, { flag: "wx" });
process.env.DATABASE_URL = "postgresql://invalid:invalid@invalid:1/invalid";

async function main() {
  let generators = [];
  try {
    generators = await getGenerators({ schemaPath, skipDownload: true,
      registry: { "prisma-client-js": { type: "rpc", isNode: true, generatorPath: require.resolve("@prisma/client/generator-build") } } });
    if (generators.length !== 1 || generators[0].options?.generator?.output?.value !== output) {
      throw new Error("Unexpected generator output; refusing to generate");
    }
    await generators[0].generate();
    console.info("Generated ignored JS-engine test client; the normal native production client is not verified.");
  } finally {
    for (const item of generators) item.stop();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
