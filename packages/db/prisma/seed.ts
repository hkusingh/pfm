import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const SITE_ADMIN_EMAIL = 'hksingh@gmail.com';

async function main() {
  // ── Registration policy ──────────────────────────────────────────────────────
  // Ensure exactly one RegistrationPolicy row exists (id=1).
  await prisma.registrationPolicy.upsert({
    where: { id: 1 },
    create: { id: 1, mode: 'admin_invite' },
    update: {},
  });
  console.log('Seed: RegistrationPolicy set to admin_invite.');

  // ── Site admin bootstrap ─────────────────────────────────────────────────────
  // The first site admin can't be invited by anyone, so we seed them directly.
  // If they already exist, just ensure isSiteAdmin is true.
  const existing = await prisma.user.findUnique({ where: { email: SITE_ADMIN_EMAIL } });

  if (existing) {
    await prisma.user.update({
      where: { email: SITE_ADMIN_EMAIL },
      data: { isSiteAdmin: true },
    });
    console.log(`Seed: ${SITE_ADMIN_EMAIL} promoted to site admin.`);
  } else {
    // Create with a placeholder password — admin must reset via forgot-password flow.
    const passwordHash = await argon2.hash('change-me-immediately-' + Math.random());
    await prisma.user.create({
      data: {
        email: SITE_ADMIN_EMAIL,
        passwordHash,
        isSiteAdmin: true,
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`Seed: created site admin ${SITE_ADMIN_EMAIL} — use forgot-password to set a real password.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
