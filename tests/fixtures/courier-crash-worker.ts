// Spawned only by the opt-in disposable PostgreSQL suite. It verifies the
// generated cluster itself before importing application services or writing.
// All fetch calls are intercepted; this worker cannot contact a courier.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const messageSchema = z.object({
  host: z.literal("127.0.0.1"), port: z.number().int().min(1).max(65535),
  user: z.string().regex(/^fixture_[a-f0-9]{16}$/), password: z.string().regex(/^[a-f0-9]{48}$/),
  database: z.string().regex(/^phase1_[a-f0-9]{16}$/), directory: z.string(),
  orderId: z.string().min(1), actorId: z.literal("phase1-fixture-actor"),
}).strict();

process.once("message", async (message: unknown) => {
  let client: PrismaClient | undefined;
  try {
    const input = messageSchema.parse(message);
    const directory = await realpath(input.directory);
    const testRoot = await realpath(path.resolve(process.cwd(), "tmp"));
    if (!directory.startsWith(`${testRoot}${path.sep}phase1-postgres-`) || !directory.endsWith(`${path.sep}data`)) {
      throw new Error("Refusing a data directory outside the owned fixture root");
    }
    client = new PrismaClient({ adapter: new PrismaPg({
      host: input.host, port: input.port, user: input.user, password: input.password, database: input.database, ssl: false,
    }) });
    const [identity] = await client.$queryRaw<Array<{ directory: string; database: string; username: string; port: number; host: string; schema: string }>>`
      SELECT current_setting('data_directory') AS "directory", current_database()::text AS "database",
        current_user::text AS "username", inet_server_port() AS "port", host(inet_server_addr()) AS "host",
        current_schema()::text AS "schema"
    `;
    if (!identity || await realpath(identity.directory) !== directory || identity.database !== input.database
      || identity.username !== input.user || identity.port !== input.port || identity.host !== input.host || identity.schema !== "public") {
      throw new Error("Refusing to run the crash worker on an unverified database");
    }
    // src/lib/prisma uses this existing instance in NODE_ENV=test. Its fallback
    // DATABASE_URL is intentionally invalid, so it cannot reach another DB.
    Object.assign(globalThis, { prisma: client });
    globalThis.fetch = async () => {
      if (process.send) process.send({ event: "mock-provider-entered" });
      return new Promise<Response>(() => {}); // Parent kills this process while the mocked provider is in flight.
    };
    const { bookCourierShipment } = await import("../../src/services/orders");
    await bookCourierShipment(input.orderId, "steadfast", input.actorId);
    throw new Error("The mocked provider unexpectedly returned");
  } catch (error) {
    if (process.send) process.send({ event: "worker-error", message: error instanceof Error ? error.message : "unknown" });
    await client?.$disconnect();
    process.exitCode = 1;
    process.disconnect?.();
  }
});
