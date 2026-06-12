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
import type { ImportPreviewResponse, ImportCommitBody, ImportCommitResponse } from '@pfm/contracts';
import type { CsvColumnMapping } from '@pfm/contracts';
import { parsePdf } from './pdf-parser';

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
          originalName: file.originalname,
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
          originalName: file.originalname,
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
        originalName: file.originalname,
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
    const format = detectFormat(importFile.originalName, '');

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

    // Upsert transactions, skip duplicates via dedupHash
    let imported = 0;
    let skipped = 0;
    let errors = 0;

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

        // Apply category rules if available
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
            postedDate: new Date(row.date),
            merchant: row.merchant,
            amountMinor: row.amountMinor,
            currency: account.currency,
            dedupHash,
            categoryId,
            importBatchId: batch.id,
          },
        });
        imported++;
      } catch {
        errors++;
      }
    }

    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'done', importedCount: imported, skippedCount: skipped },
    });

    return { imported, skipped, errors };
  }

  // ── E3.3 — List import history ────────────────────────────────────────────

  async listBatches(householdId: string) {
    const batches = await prisma.importBatch.findMany({
      where: { householdId, status: 'done' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        files: { select: { originalName: true } },
        account: { select: { name: true, mask: true } },
      },
    });

    return batches.map((b) => ({
      id: b.id,
      originalName: b.files[0]?.originalName ?? 'Unknown file',
      accountName: b.account ? `${b.account.name}${b.account.mask ? ` ····${b.account.mask}` : ''}` : null,
      importedCount: b.importedCount,
      skippedCount: b.skippedCount,
      createdAt: b.createdAt.toISOString(),
    }));
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
