/**
 * Demo household seed — "The Smith Family"
 *
 * Creates a read-only demo user + realistic household data covering every
 * tour stop (dashboard, accounts, transactions, budgets, sinking funds, reports).
 *
 * Run:  SEED_DEMO=true pnpm --filter @pfm/db seed:demo
 * Safe to re-run (fully idempotent — upserts by stable keys, deletes old data).
 *
 * All financial fields are encrypted via the shared @pfm/core crypto helpers
 * using the same ENCRYPTION_KEY as the running API.
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { encryptField, hmacField, deriveHmacKey, masterKeyFromEnv, DEFAULT_CATEGORIES } from '@pfm/core';

if (process.env.SEED_DEMO !== 'true') {
  console.log('SEED_DEMO is not set to "true" — skipping demo seed.');
  process.exit(0);
}

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@demo.pfm.invalid';
const DEMO_HOUSEHOLD_NAME = 'The Smith Family';

// ── Crypto helpers ────────────────────────────────────────────────────────────

const masterKey = masterKeyFromEnv();
const hmacKey = deriveHmacKey(masterKey);

function enc(value: string, householdId: string): string {
  return encryptField(value, masterKey, householdId);
}
function hmac(value: string): string {
  return hmacField(value, hmacKey);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function monthsAgo(n: number, day = 15): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n, day);
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}
function periodKey(monthsBack: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsBack);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Demo user ──────────────────────────────────────────────────────────────
  const passwordHash = await argon2.hash('demo-user-no-login-' + Math.random());
  const demoUser = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      name: 'Demo Visitor',
      emailVerifiedAt: new Date(),
    },
    update: { name: 'Demo Visitor', emailVerifiedAt: new Date() },
  });
  console.log(`Demo user: ${demoUser.id}`);

  // ── Demo household ────────────────────────────────────────────────────────
  let household = await prisma.household.findFirst({
    where: { name: DEMO_HOUSEHOLD_NAME },
  });
  if (!household) {
    household = await prisma.household.create({
      data: { name: DEMO_HOUSEHOLD_NAME, baseCurrency: 'USD', monthStartDay: 1 },
    });
  }
  const hid = household.id;
  console.log(`Demo household: ${hid}`);

  // Ensure demo user is the sole active member
  await prisma.membership.deleteMany({ where: { householdId: hid } });
  await prisma.membership.create({
    data: {
      householdId: hid,
      userId: demoUser.id,
      role: 'member',
      status: 'active',
      isPrimaryOwner: false,
    },
  });

  // ── Wipe existing demo financial data (idempotent re-seed) ────────────────
  await prisma.transaction.deleteMany({ where: { account: { householdId: hid } } });
  await prisma.account.deleteMany({ where: { householdId: hid } });
  await prisma.budget.deleteMany({ where: { householdId: hid } });
  await prisma.sinkingFund.deleteMany({ where: { householdId: hid } });

  // ── Accounts ──────────────────────────────────────────────────────────────
  const [checking, savings, creditCard, personal, investment] = await Promise.all([
    prisma.account.create({ data: {
      householdId: hid,
      name: enc('Chase Checking', hid),
      type: 'checking',
      institution: enc('Chase', hid),
      mask: enc('4821', hid),
      balanceMinor: enc('483217', hid),
      currency: 'USD',
      visibility: 'shared',
      balanceAsOf: new Date(),
    }}),
    prisma.account.create({ data: {
      householdId: hid,
      name: enc('Chase Savings', hid),
      type: 'savings',
      institution: enc('Chase', hid),
      mask: enc('9134', hid),
      balanceMinor: enc('1850000', hid),
      currency: 'USD',
      visibility: 'shared',
      balanceAsOf: new Date(),
    }}),
    prisma.account.create({ data: {
      householdId: hid,
      name: enc('Citi Double Cash', hid),
      type: 'credit_card',
      institution: enc('Citi', hid),
      mask: enc('3377', hid),
      balanceMinor: enc('-124783', hid),
      currency: 'USD',
      visibility: 'shared',
      balanceAsOf: new Date(),
    }}),
    prisma.account.create({ data: {
      householdId: hid,
      name: enc('Alex Personal Checking', hid),
      type: 'checking',
      institution: enc('Bank of America', hid),
      mask: enc('5512', hid),
      balanceMinor: enc('320000', hid),
      currency: 'USD',
      visibility: 'private',
      balanceAsOf: new Date(),
    }}),
    prisma.account.create({ data: {
      householdId: hid,
      name: enc('Vanguard 401(k)', hid),
      type: 'investment',
      institution: enc('Vanguard', hid),
      balanceMinor: enc('4582000', hid),
      currency: 'USD',
      visibility: 'balance_only',
      balanceAsOf: new Date(),
    }}),
  ]);

  console.log('Accounts created.');

  // ── Categories — seed defaults if not already present ────────────────────
  const existingCats = await prisma.category.findMany({ where: { householdId: hid } });
  if (existingCats.length === 0) {
    for (const cat of DEFAULT_CATEGORIES) {
      const parent = await prisma.category.create({
        data: { householdId: hid, name: cat.name, color: cat.color,
                kind: cat.kind, isSystem: cat.isSystem, sortOrder: cat.sortOrder },
      });
      for (const child of cat.children) {
        await prisma.category.create({
          data: { householdId: hid, parentId: parent.id, name: child.name,
                  kind: cat.kind, isSystem: false, sortOrder: child.sortOrder },
        });
      }
    }
  }

  const allCats = await prisma.category.findMany({ where: { householdId: hid } });

  function catId(name: string): string | null {
    return allCats.find(c => c.name === name)?.id ?? null;
  }

  const salaryId   = catId('Salary');
  const grocId     = catId('Groceries');
  const diningId   = catId('Dining out');
  const rentId     = catId('Rent / Mortgage');
  const utilId     = catId('Utilities');
  const subsId     = catId('Subscriptions');
  const medId      = catId('Medical');
  const clothId    = catId('Clothing');
  const actId      = catId('Activities');
  const travelId   = catId('Flights');
  const gasId      = catId('Gas');
  const propTaxId  = catId('Property tax');

  // ── Transactions ──────────────────────────────────────────────────────────
  // Helper: create one transaction (encrypts all sensitive fields)
  let txSeq = 0;
  async function tx(
    accountId: string,
    date: Date,
    amountCents: number,
    merchantName: string,
    categoryId: string | null,
  ) {
    txSeq++;
    const merchantNorm = merchantName.toLowerCase().trim();
    const dedupHash = `demo-${hid}-${txSeq}`;
    return prisma.transaction.create({ data: {
      accountId,
      postedDate: date,
      merchant: enc(merchantName, hid),
      merchantNormalized: enc(merchantNorm, hid),
      merchantRuleHash: hmac(merchantNorm),
      amountMinor: enc(String(amountCents), hid),
      currency: 'USD',
      categoryId,
      dedupHash,
    }});
  }

  // 6 months of realistic transactions
  const txPromises = [
    // ── Month 0 (current) ─────────────────────────────────────────────────
    tx(checking.id,    daysAgo(2),  550000, 'Payroll Direct Deposit', salaryId),
    tx(checking.id,    daysAgo(3),   -8743,  'Whole Foods Market',     grocId),
    tx(creditCard.id,  daysAgo(4),   -6250,  'Chipotle Mexican Grill', diningId),
    tx(creditCard.id,  daysAgo(5),   -1499,  'Netflix',                subsId),
    tx(creditCard.id,  daysAgo(6),   -1099,  'Spotify',                subsId),
    tx(checking.id,    daysAgo(7),  -200000, 'Landlord LLC',           rentId),
    tx(creditCard.id,  daysAgo(8),   -4312,  'Safeway',                grocId),
    tx(creditCard.id,  daysAgo(10),  -3800,  'Shell Gas Station',      gasId),
    tx(creditCard.id,  daysAgo(11),  -8900,  'The Cheesecake Factory', diningId),
    tx(checking.id,    daysAgo(12), -14200,  'PG&E Electric',          utilId),
    tx(creditCard.id,  daysAgo(14),  -2499,  'Amazon Prime',           subsId),
    tx(creditCard.id,  daysAgo(15),  -7600,  'Trader Joe\'s',          grocId),
    tx(creditCard.id,  daysAgo(18),  -5499,  'Olive Garden',           diningId),

    // ── Month 1 ────────────────────────────────────────────────────────────
    tx(checking.id,    monthsAgo(1, 1),  550000, 'Payroll Direct Deposit', salaryId),
    tx(creditCard.id,  monthsAgo(1, 3),   -9100,  'Whole Foods Market',     grocId),
    tx(checking.id,    monthsAgo(1, 1),  -200000, 'Landlord LLC',           rentId),
    tx(creditCard.id,  monthsAgo(1, 5),   -7250,  'Shake Shack',            diningId),
    tx(creditCard.id,  monthsAgo(1, 6),   -1499,  'Netflix',                subsId),
    tx(creditCard.id,  monthsAgo(1, 7),   -1099,  'Spotify',                subsId),
    tx(checking.id,    monthsAgo(1, 10), -13800,  'AT&T Wireless',          utilId),
    tx(creditCard.id,  monthsAgo(1, 12),  -4900,  'Safeway',                grocId),
    tx(creditCard.id,  monthsAgo(1, 14),  -3600,  'Chevron',                gasId),
    tx(creditCard.id,  monthsAgo(1, 18),  -8200,  'Sushi Roku',             diningId),
    tx(creditCard.id,  monthsAgo(1, 20), -24999,  'Macy\'s',                clothId),
    tx(checking.id,    monthsAgo(1, 22), -14500,  'PG&E Electric',          utilId),
    tx(creditCard.id,  monthsAgo(1, 25),  -6100,  'Trader Joe\'s',          grocId),

    // ── Month 2 ────────────────────────────────────────────────────────────
    tx(checking.id,    monthsAgo(2, 1),  550000, 'Payroll Direct Deposit', salaryId),
    tx(checking.id,    monthsAgo(2, 1),  -200000, 'Landlord LLC',           rentId),
    tx(creditCard.id,  monthsAgo(2, 4),   -8500,  'Whole Foods Market',     grocId),
    tx(creditCard.id,  monthsAgo(2, 5),   -1499,  'Netflix',                subsId),
    tx(creditCard.id,  monthsAgo(2, 5),   -1099,  'Spotify',                subsId),
    tx(creditCard.id,  monthsAgo(2, 7),   -6800,  'In-N-Out Burger',        diningId),
    tx(checking.id,    monthsAgo(2, 10), -13200,  'PG&E Electric',          utilId),
    tx(creditCard.id,  monthsAgo(2, 12),  -5500,  'Safeway',                grocId),
    tx(creditCard.id,  monthsAgo(2, 15),  -4100,  'Shell Gas Station',      gasId),
    tx(creditCard.id,  monthsAgo(2, 16), -18500,  'Nordstrom',              clothId),
    tx(creditCard.id,  monthsAgo(2, 19),  -9200,  'Nobu Restaurant',        diningId),
    tx(creditCard.id,  monthsAgo(2, 22),  -7300,  'Trader Joe\'s',          grocId),
    tx(creditCard.id,  monthsAgo(2, 28), -29900,  'AMC Theatres + Dinner',  actId),

    // ── Month 3 ────────────────────────────────────────────────────────────
    tx(checking.id,    monthsAgo(3, 1),  550000, 'Payroll Direct Deposit', salaryId),
    tx(checking.id,    monthsAgo(3, 1),  -200000, 'Landlord LLC',           rentId),
    tx(creditCard.id,  monthsAgo(3, 3),   -9800,  'Whole Foods Market',     grocId),
    tx(creditCard.id,  monthsAgo(3, 5),   -1499,  'Netflix',                subsId),
    tx(creditCard.id,  monthsAgo(3, 5),   -1099,  'Spotify',                subsId),
    tx(checking.id,    monthsAgo(3, 10), -14100,  'AT&T Wireless',          utilId),
    tx(creditCard.id,  monthsAgo(3, 12),  -6200,  'Safeway',                grocId),
    tx(creditCard.id,  monthsAgo(3, 14),  -3900,  'Shell Gas Station',      gasId),
    tx(creditCard.id,  monthsAgo(3, 17),  -7400,  'Chipotle Mexican Grill', diningId),
    tx(creditCard.id,  monthsAgo(3, 20),  -4500,  'Trader Joe\'s',          grocId),
    tx(checking.id,    monthsAgo(3, 22), -135000, 'United Airlines',        travelId),
    tx(checking.id,    monthsAgo(3, 25),  -15000, 'CVS Pharmacy',           medId),

    // ── Month 4 ────────────────────────────────────────────────────────────
    tx(checking.id,    monthsAgo(4, 1),  550000, 'Payroll Direct Deposit', salaryId),
    tx(checking.id,    monthsAgo(4, 1),  -200000, 'Landlord LLC',           rentId),
    tx(creditCard.id,  monthsAgo(4, 4),   -8100,  'Whole Foods Market',     grocId),
    tx(creditCard.id,  monthsAgo(4, 5),   -1499,  'Netflix',                subsId),
    tx(creditCard.id,  monthsAgo(4, 5),   -1099,  'Spotify',                subsId),
    tx(checking.id,    monthsAgo(4, 10), -13600,  'PG&E Electric',          utilId),
    tx(creditCard.id,  monthsAgo(4, 12),  -5800,  'Safeway',                grocId),
    tx(creditCard.id,  monthsAgo(4, 15),  -9700,  'Sushi Roku',             diningId),
    tx(creditCard.id,  monthsAgo(4, 18),  -3700,  'Shell Gas Station',      gasId),
    tx(creditCard.id,  monthsAgo(4, 22),  -7200,  'Trader Joe\'s',          grocId),
    tx(checking.id,    monthsAgo(4, 26), -22000,  'Stanford Health Care',   medId),

    // ── Month 5 ────────────────────────────────────────────────────────────
    tx(checking.id,    monthsAgo(5, 1),  550000, 'Payroll Direct Deposit', salaryId),
    tx(checking.id,    monthsAgo(5, 1),  -200000, 'Landlord LLC',           rentId),
    tx(creditCard.id,  monthsAgo(5, 3),   -9300,  'Whole Foods Market',     grocId),
    tx(creditCard.id,  monthsAgo(5, 5),   -1499,  'Netflix',                subsId),
    tx(creditCard.id,  monthsAgo(5, 5),   -1099,  'Spotify',                subsId),
    tx(checking.id,    monthsAgo(5, 8),  -14800,  'AT&T Wireless',          utilId),
    tx(creditCard.id,  monthsAgo(5, 11),  -5200,  'Safeway',                grocId),
    tx(creditCard.id,  monthsAgo(5, 14),  -3500,  'Chevron',                gasId),
    tx(creditCard.id,  monthsAgo(5, 16),  -8800,  'The Cheesecake Factory', diningId),
    tx(creditCard.id,  monthsAgo(5, 20),  -6900,  'Trader Joe\'s',          grocId),
    tx(checking.id,    monthsAgo(5, 24), -180000, 'Marriott Bonvoy Hotels', travelId),
    tx(checking.id,    monthsAgo(5, 27), -120000, 'United Airlines',        travelId),
    tx(creditCard.id,  monthsAgo(5, 28),  -45000, 'Coach',                  clothId),
  ];

  await Promise.all(txPromises);
  console.log(`${txPromises.length} transactions created.`);

  // ── Budgets (current + 2 prior months) ───────────────────────────────────
  const budgetDefs = [
    { catId: grocId,   amounts: [50000, 50000, 50000] },
    { catId: diningId, amounts: [40000, 40000, 40000] },
    { catId: utilId,   amounts: [20000, 20000, 20000] },
    { catId: subsId,   amounts: [5000,  5000,  5000]  },
    { catId: actId,    amounts: [10000, 10000, 10000] },
    { catId: gasId,    amounts: [8000,  8000,  8000]  },
  ];

  for (const { catId, amounts } of budgetDefs) {
    if (!catId) continue;
    for (let m = 0; m < amounts.length; m++) {
      await prisma.budget.upsert({
        where: { householdId_categoryId_period: {
          householdId: hid,
          categoryId: catId,
          period: periodKey(m),
        }},
        create: { householdId: hid, categoryId: catId, period: periodKey(m), amountMinor: amounts[m] },
        update: { amountMinor: amounts[m] },
      });
    }
  }
  console.log('Budgets created.');

  // ── Sinking funds ─────────────────────────────────────────────────────────
  const sinkingDefs = [
    {
      catId: propTaxId,
      name: 'Property Tax',
      totalMinor: 240000,      // $2,400/year
      nextDue: monthsAgo(-3), // 3 months from now
    },
    {
      catId: travelId,
      name: 'Family Vacation',
      totalMinor: 300000,      // $3,000/year
      nextDue: monthsAgo(-5),
    },
  ];

  for (const sf of sinkingDefs) {
    if (!sf.catId) continue;
    const existing = await prisma.sinkingFund.findFirst({
      where: { householdId: hid, categoryId: sf.catId },
    });
    if (!existing) {
      await prisma.sinkingFund.create({ data: {
        householdId: hid,
        categoryId: sf.catId,
        cadence: 'annual',
        totalMinor: sf.totalMinor,
        nextDueDate: sf.nextDue,
        method: 'amortized',
        reserveBalanceMinor: Math.floor(sf.totalMinor * 0.4),
      }});
    }
  }
  console.log('Sinking funds created.');

  console.log('\n✅  Demo seed complete.');
  console.log(`   Household: "${DEMO_HOUSEHOLD_NAME}" (id: ${hid})`);
  console.log(`   Demo user: ${DEMO_EMAIL}`);
  console.log(`   Start demo: POST /auth/demo`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
