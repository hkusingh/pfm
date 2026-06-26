import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { prisma } from '@pfm/db';
import {
  parseCsvPreview,
  applyCsvMapping,
  parseOfx,
  computeDedupHash,
  normalizeMerchant,
} from '@pfm/core';
import type { ImportPreviewResponse, ImportCommitBody, ImportCommitResponse, ConfirmFlaggedBody } from '@pfm/contracts';
import type { CsvColumnMapping, FlaggedDuplicate } from '@pfm/contracts';
import { parsePdf } from './pdf-parser';
import { TransactionService } from '../transaction/transaction.service';
import { EncryptionService } from '../common/encryption.service';

// Phase 1: local filesystem. Swap for GCS-backed impl in production.
class LocalObjectStore {
  private base: string;
  constructor(base: string) {
    this.base = base;
    fs.mkdirSync(base, { recursive: true });
  }
  put(key: string, data: Buffer): void {
    const full = path.join(this.base, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  }
  get(key: string): Buffer {
    const full = path.join(this.base, key);
    if (!fs.existsSync(full)) throw new NotFoundException('Uploaded file not found');
    return fs.readFileSync(full);
  }
}

const UPLOADS_BASE = process.env.UPLOADS_PATH ?? './uploads';
const store = new LocalObjectStore(UPLOADS_BASE);

type FileFormat = 'csv' | 'ofx' | 'qfx' | 'pdf';

function detectFormat(originalName: string, mimeType: string): FileFormat {
  const name = originalName.toLowerCase();
  if (name.endsWith('.ofx') || mimeType === 'application/x-ofx') return 'ofx';
  if (name.endsWith('.qfx') || mimeType === 'application/x-qfx') return 'qfx';
  if (name.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf';
  return 'csv';
}

@Injectable()
export class ImportService {
  constructor(
    private readonly txService: TransactionService,
    private readonly encryption: EncryptionService,
  ) {}

  // ── E3.1 — Upload + preview ───────────────────────────────────────────────

  async preview(
    householdId: string,
    uploaderUserId: string,
    file: Express.Multer.File,
  ): Promise<ImportPreviewResponse> {
    const format = detectFormat(file.originalname, file.mimetype);
    const buffer = file.buffer;

    // Create a pending batch to anchor the file record
    const batch = await prisma.importBatch.create({
      data: { householdId, uploaderUserId, status: 'pending' },
    });

    // Store the file locally (key = householdId/batchId/filename)
    const storageKey = `${householdId}/${batch.id}/${file.originalname}`;
    store.put(storageKey, buffer);

    // Parse preview
    if (format === 'csv') {
      const preview = parseCsvPreview(buffer, file.originalname);

      // Persist the ImportFile record
      await prisma.importFile.create({
        data: {
          importBatchId: batch.id,
          storageKey,
          sourceFingerprint: preview.fingerprint,
          originalName: this.encryption.encrypt(file.originalname, householdId),
        },
      });

      // Look up any saved column mapping for this fingerprint
      const saved = await prisma.columnMapping.findUnique({
        where: { householdId_sourceFingerprint: { householdId, sourceFingerprint: preview.fingerprint } },
      });
      const suggestedMapping = saved
        ? (saved.mapping as CsvColumnMapping)
        : preview.suggestedMapping;

      return {
        batchId: batch.id,
        format: 'csv',
        columns: preview.columns,
        sampleRows: preview.sampleRows,
        rowCount: preview.rowCount,
        fingerprint: preview.fingerprint,
        suggestedMapping,
        autoMapped: false,
      };
    }

    // PDF
    if (format === 'pdf') {
      const parsed = await parsePdf(buffer);
      const fingerprint = createHash('sha256')
        .update(`${file.originalname}|${buffer.length}`)
        .digest('hex');

      await prisma.importFile.create({
        data: {
          importBatchId: batch.id,
          storageKey,
          sourceFingerprint: fingerprint,
          originalName: this.encryption.encrypt(file.originalname, householdId),
        },
      });

      // Build sample rows for preview display (date/merchant/amount columns)
      const sampleRows = parsed.rows.slice(0, 5).map((r) => ({
        date: r.date,
        merchant: r.merchant ?? '',
        amount: (r.amountMinor / 100).toFixed(2),
      }));

      return {
        batchId: batch.id,
        format: 'pdf',
        columns: ['date', 'merchant', 'amount'],
        sampleRows,
        rowCount: parsed.rowCount,
        fingerprint,
        suggestedMapping: null,
        autoMapped: true,
      };
    }

    // OFX / QFX
    const parsed = parseOfx(buffer);
    const fingerprint = createHash('sha256')
      .update(`${file.originalname}|${buffer.length}`)
      .digest('hex');

    await prisma.importFile.create({
      data: {
        importBatchId: batch.id,
        storageKey,
        sourceFingerprint: fingerprint,
        originalName: this.encryption.encrypt(file.originalname, householdId),
      },
    });

    return {
      batchId: batch.id,
      format,
      columns: null,
      sampleRows: null,
      rowCount: parsed.rowCount,
      fingerprint,
      suggestedMapping: null,
      autoMapped: true,
    };
  }

  // ── E3.2 — Commit ─────────────────────────────────────────────────────────

  async commit(
    householdId: string,
    _uploaderUserId: string,
    body: ImportCommitBody,
  ): Promise<ImportCommitResponse> {
    const batch = await prisma.importBatch.findUnique({
      where: { id: body.batchId },
      include: { files: true },
    });

    if (!batch || batch.householdId !== householdId) {
      throw new NotFoundException('Import batch not found');
    }
    if (batch.status === 'done') {
      throw new BadRequestException('This batch has already been committed');
    }

    // Validate the target account belongs to this household
    const account = await prisma.account.findUnique({ where: { id: body.accountId } });
    if (!account || account.householdId !== householdId) {
      throw new BadRequestException('Account not found in this household');
    }

    if (batch.files.length === 0) {
      throw new BadRequestException('No file found for this batch');
    }
    const importFile = batch.files[0];

    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'processing', accountId: body.accountId },
    });

    const buffer = store.get(importFile.storageKey);
    const decryptedOriginalName = this.encryption.decrypt(importFile.originalName, householdId);
    const format = detectFormat(decryptedOriginalName, '');

    let rows: { date: string; merchant: string | null; amountMinor: number }[] = [];

    if (format === 'csv') {
      if (!body.mapping) throw new BadRequestException('Column mapping is required for CSV files');

      // Save/update column mapping for future same-fingerprint files
      await prisma.columnMapping.upsert({
        where: {
          householdId_sourceFingerprint: {
            householdId,
            sourceFingerprint: importFile.sourceFingerprint,
          },
        },
        create: {
          householdId,
          sourceFingerprint: importFile.sourceFingerprint,
          mapping: body.mapping as object,
        },
        update: { mapping: body.mapping as object },
      });

      rows = applyCsvMapping(buffer, body.mapping);
    } else if (format === 'pdf') {
      rows = (await parsePdf(buffer)).rows;
    } else {
      rows = parseOfx(buffer).rows;
    }

    // Upsert transactions, skip duplicates via dedupHash.
    // Exact-hash match is the fast path. When it misses (banks sometimes include
    // variable trailing info — phone numbers, city codes — in the merchant name
    // between different statement exports of the same account), fall back to a
    // fuzzy check: same account + date + amount + same first word of normalized
    // merchant. This catches "APPLE.COM/BILL" vs "APPLE.COM/BILL 800-275-2273 CA"
    // and similar bank-description variations without false-positives.
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const flagged: FlaggedDuplicate[] = [];
    const importedTxIds: string[] = [];

    for (const row of rows) {
      try {
        const normalizedMerchant = normalizeMerchant(row.merchant);
        const dedupHash = computeDedupHash(
          account.id,
          row.date,
          row.amountMinor,
          normalizedMerchant,
        );

        const existing = await prisma.transaction.findUnique({
          where: { accountId_dedupHash: { accountId: account.id, dedupHash } },
        });
        if (existing) { skipped++; continue; }

        // Fuzzy dedup fallback — only runs when exact hash misses.
        // Same account + date + matching first word of normalized merchant + matching amount.
        // Amount filter moved to JS since amountMinor is now encrypted.
        const postedDate = new Date(row.date);
        const candidates = await prisma.transaction.findMany({
          where: { accountId: account.id, postedDate },
          select: {
            id: true,
            merchant: true,
            amountMinor: true,
            postedDate: true,
            category: { select: { name: true, color: true } },
          },
        });
        if (candidates.length > 0) {
          const incomingPrefix = normalizedMerchant.split(' ')[0];
          const fuzzyMatch = candidates.find((c) => {
            // Amount must match (decrypt to compare)
            const existingAmt = parseInt(this.encryption.decrypt(c.amountMinor, householdId), 10);
            if (existingAmt !== row.amountMinor) return false;
            const decMerchant = c.merchant ? this.encryption.decrypt(c.merchant, householdId) : null;
            if (!decMerchant && !row.merchant) return true;
            if (!decMerchant || !row.merchant) return false;
            const existingPrefix = normalizeMerchant(decMerchant).split(' ')[0];
            return incomingPrefix && existingPrefix === incomingPrefix;
          });
          if (fuzzyMatch) {
            const decMerchant = fuzzyMatch.merchant
              ? this.encryption.decrypt(fuzzyMatch.merchant, householdId)
              : null;
            flagged.push({
              date: row.date,
              merchant: row.merchant ?? null,
              amountMinor: row.amountMinor,
              existingId: fuzzyMatch.id,
              existingMerchant: decMerchant,
              existingCategoryName: fuzzyMatch.category?.name ?? null,
              existingCategoryColor: fuzzyMatch.category?.color ?? null,
              existingPostedDate: fuzzyMatch.postedDate.toISOString().slice(0, 10),
            });
            continue;
          }
        }

        // Apply category rules if available
        let categoryId: string | null = null;
        if (row.merchant) {
          const rule = await prisma.categoryRule.findFirst({
            where: { householdId, merchantMatch: normalizedMerchant },
          });
          if (rule) categoryId = rule.categoryId;
        }

        const newTx = await prisma.transaction.create({
          data: {
            accountId: account.id,
            postedDate,
            merchant: row.merchant ? this.encryption.encrypt(row.merchant, householdId) : null,
            merchantNormalized: normalizedMerchant
              ? this.encryption.encrypt(normalizedMerchant, householdId)
              : null,
            merchantRuleHash: normalizedMerchant ? this.encryption.hmac(normalizedMerchant) : null,
            amountMinor: this.encryption.encrypt(String(row.amountMinor), householdId),
            currency: account.currency,
            dedupHash,
            categoryId,
            importBatchId: batch.id,
          },
        });
        importedTxIds.push(newTx.id);
        imported++;
      } catch (err) {
        console.error('Import row error:', err);
        errors++;
      }
    }

    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'done', importedCount: imported, skippedCount: skipped },
    });

    // Resolve transfer links for the newly imported transactions (Steps A/B/C)
    const needsRouting = await this.txService.resolveTransferLinks(householdId, importedTxIds);

    return { imported, skipped, errors, flagged, needsRouting };
  }

  // ── E3.2b — Confirm flagged (import fuzzy-matched rows user approved) ───────

  async confirmFlagged(
    householdId: string,
    batchId: string,
    body: ConfirmFlaggedBody,
  ): Promise<{ imported: number }> {
    const batch = await prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { files: false },
    });
    if (!batch || batch.householdId !== householdId) {
      throw new NotFoundException('Import batch not found');
    }
    if (!batch.accountId) throw new BadRequestException('Batch has no account');

    const account = await prisma.account.findUnique({ where: { id: batch.accountId } });
    if (!account) throw new BadRequestException('Account not found');

    let imported = 0;
    for (const row of body.rows) {
      const normalizedMerchant = normalizeMerchant(row.merchant);
      const postedDate = new Date(row.date);
      await this.insertRow(account, batchId, householdId, row, postedDate, normalizedMerchant);
      imported++;
    }

    // Bump importedCount on the batch
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { importedCount: { increment: imported } },
    });

    return { imported };
  }

  // ── Shared row-insert helper ──────────────────────────────────────────────

  private async insertRow(
    account: { id: string; currency: string },
    batchId: string,
    householdId: string,
    row: { date: string; merchant: string | null; amountMinor: number },
    postedDate: Date,
    normalizedMerchant: string,
  ) {
    // Generate a unique hash by appending a random nonce so force-imported rows
    // don't collide with the existing entry that caused the fuzzy match.
    const nonce = Math.random().toString(36).slice(2);
    const dedupHash = computeDedupHash(account.id, row.date, row.amountMinor, normalizedMerchant + nonce);

    let categoryId: string | null = null;
    if (row.merchant) {
      const rule = await prisma.categoryRule.findFirst({
        where: { householdId, merchantMatch: normalizedMerchant },
      });
      if (rule) categoryId = rule.categoryId;
    }

    await prisma.transaction.create({
      data: {
        accountId: account.id,
        postedDate,
        merchant: row.merchant ? this.encryption.encrypt(row.merchant, householdId) : null,
        merchantNormalized: normalizedMerchant
          ? this.encryption.encrypt(normalizedMerchant, householdId)
          : null,
        merchantRuleHash: normalizedMerchant ? this.encryption.hmac(normalizedMerchant) : null,
        amountMinor: this.encryption.encrypt(String(row.amountMinor), householdId),
        currency: account.currency,
        dedupHash,
        categoryId,
        importBatchId: batchId,
      },
    });
  }

  // ── E3.3 — List import history ────────────────────────────────────────────

  async listBatches(householdId: string): Promise<{ id: string; originalName: string; accountName: string | null; importedCount: number; skippedCount: number; createdAt: string }[]> {
    const batches = await prisma.importBatch.findMany({
      where: { householdId, status: 'done' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        files: { select: { originalName: true } },
        account: { select: { name: true, mask: true } },
      },
    });

    return batches.map((b) => {
      const rawOriginalName = b.files[0]?.originalName;
      const originalName = rawOriginalName
        ? this.encryption.decrypt(rawOriginalName, householdId)
        : 'Unknown file';
      let accountName: string | null = null;
      if (b.account) {
        const name = this.encryption.decrypt(b.account.name, householdId);
        const mask = b.account.mask ? this.encryption.decrypt(b.account.mask, householdId) : null;
        accountName = `${name}${mask ? ` ····${mask}` : ''}`;
      }
      return { id: b.id, originalName, accountName, importedCount: b.importedCount, skippedCount: b.skippedCount, createdAt: b.createdAt.toISOString() };
    });
  }

  // ── E3.4 — Delete batch (rolls back all its transactions) ─────────────────

  async deleteBatch(batchId: string, householdId: string): Promise<{ deleted: number }> {
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch || batch.householdId !== householdId) {
      throw new NotFoundException('Import batch not found');
    }

    // Delete all transactions that came from this batch, then the batch itself.
    // Transactions are deleted first because there's no cascade on the relation.
    const { count } = await prisma.transaction.deleteMany({ where: { importBatchId: batchId } });
    await prisma.importBatch.delete({ where: { id: batchId } });

    return { deleted: count };
  }
}
