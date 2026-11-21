import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seed } from "./seed-core";

const prisma = new PrismaClient();
seed(prisma, process.env)
  .then(({ email, includeDemo }) => {
    console.log(`Seed complete. Owner: ${email}. ${includeDemo ? "Demo product included." : "No demo product added."}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
