#!/usr/bin/env node
/**
 * scripts/migrate-encryption.mjs
 *
 * One-time migration for developers who had existing local financial data
 * before application-level encryption was introduced.
 *
 * What it does:
 *   1. Adds ENCRYPTION_KEY dev placeholder to .env if missing
 *   2. Truncates Account, Transaction, and ImportFile data (plaintext rows
 *      are unreadable as ciphertext after the schema change)
 *   3. Applies the pending Prisma migration
 *
 * Usage:
 *   node scripts/migrate-encryption.mjs
 *
 * Works on Mac, Linux, and Windows (PowerShell or CMD).
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const ENV_PATH = resolve(ROOT, '.env');
const IS_WIN = process.platform === 'win32';

// ── helpers ────────────────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.stdin ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: opts.stdin,
    shell: IS_WIN,
    ...opts,
  });
  if (result.status !== 0) {
    console.error(`\n❌  Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
  return result;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(question, res));
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

// ── 1. Check .env ──────────────────────────────────────────────────────────

if (!existsSync(ENV_PATH)) {
  console.error('❌  .env not found. Run ./scripts/setup-dev.sh first.');
  process.exit(1);
}

const envContent = readFileSync(ENV_PATH, 'utf8');

// ── 2. Add ENCRYPTION_KEY if missing ──────────────────────────────────────

if (!envContent.split('\n').some((l) => l.startsWith('ENCRYPTION_KEY='))) {
  // 64 zeros = 32 zero bytes. Encrypts correctly but is not secret — dev only.
  const DEV_KEY = '0'.repeat(64);
  const addition = [
    '',
    '# Application-level encryption key (dev placeholder — use openssl rand -hex 32 for production)',
    `ENCRYPTION_KEY=${DEV_KEY}`,
    '',
  ].join('\n');
  writeFileSync(ENV_PATH, envContent.trimEnd() + addition);
  console.log('✓  Added ENCRYPTION_KEY dev placeholder to .env');
} else {
  console.log('✓  ENCRYPTION_KEY already in .env');
}

// ── 3. Check whether financial tables have any data ────────────────────────

console.log('\nChecking for existing local financial data...');

// Run a quick count via prisma db execute to see if truncation is needed.
// If the migration hasn't run yet the column types are still INT and the
// tables might have plaintext rows that need to be cleared first.
const COUNT_SQL = `SELECT COUNT(*) AS n FROM "Account";`;
const countResult = spawnSync(
  'pnpm',
  ['--filter', '@pfm/db', 'exec', 'prisma', 'db', 'execute', '--stdin', '--schema=prisma/schema.prisma'],
  { cwd: ROOT, input: COUNT_SQL, shell: IS_WIN, stdio: ['pipe', 'pipe', 'pipe'] },
);

const hasData = countResult.status === 0 &&
  !countResult.stdout.toString().includes('"n":"0"') &&
  !countResult.stdout.toString().includes('"n": "0"') &&
  countResult.stdout.toString().includes('"n"');

// ── 4. Truncate if needed ─────────────────────────────────────────────────

if (hasData) {
  console.log('\n⚠️   Your local database has Account/Transaction rows that were');
  console.log('    stored as plaintext integers. They must be deleted before');
  console.log('    applying the encryption migration.\n');
  console.log('    Tables that will be cleared:');
  console.log('      • Account (and linked ImportBatch, ColumnMapping)');
  console.log('      • Transaction, TransactionSplit, TransferPair');
  console.log('      • ImportFile, ImportBatch, TransferRoute\n');
  console.log('    Kept intact: User, Household, Membership, Category,');
  console.log('    CategoryRule, Budget, SinkingFund, AuditLog\n');

  const ok = await confirm('Delete financial data and continue? [y/N] ');
  if (!ok) {
    console.log('Aborted. No changes made.');
    process.exit(0);
  }

  const TRUNCATE_SQL = `
TRUNCATE "TransactionSplit" CASCADE;
TRUNCATE "TransferPair" CASCADE;
TRUNCATE "Transaction" CASCADE;
TRUNCATE "ImportFile" CASCADE;
TRUNCATE "ImportBatch" CASCADE;
TRUNCATE "TransferRoute" CASCADE;
TRUNCATE "Account" CASCADE;
`.trim();

  console.log('\nTruncating...');
  run(
    'pnpm',
    ['--filter', '@pfm/db', 'exec', 'prisma', 'db', 'execute', '--stdin', '--schema=prisma/schema.prisma'],
    { stdin: TRUNCATE_SQL },
  );
  console.log('✓  Financial tables cleared');
} else {
  console.log('✓  No existing financial data — truncation not needed');
}

// ── 5. Apply migration ────────────────────────────────────────────────────

console.log('\nApplying Prisma migration...');
run('pnpm', ['--filter', '@pfm/db', 'migrate:dev']);

// ── 6. Done ───────────────────────────────────────────────────────────────

console.log('\n✅  Done! Your local database is ready for encrypted financial data.');
console.log('    Start the dev server: pnpm dev\n');
