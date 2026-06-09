// Seed scaffold — default categories are seeded in E4.1.
// This file is intentionally minimal in E0.2.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seed: nothing to seed in E0.2 — default categories added in E4.1.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
