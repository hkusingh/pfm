import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@pfm/db';
import { DEFAULT_CATEGORIES } from '@pfm/core';
import { normalizeMerchant } from '@pfm/core';
import type {
  CreateCategoryBody,
  UpdateCategoryBody,
  DeleteCategoryBody,
  CreateCategoryRuleBody,
  CategoryResponse,
  CategoryRuleResponse,
} from '@pfm/contracts';

function toResponse(c: {
  id: string;
  householdId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
  kind: string;
  createdAt: Date;
}): CategoryResponse {
  return {
    id: c.id,
    householdId: c.householdId,
    parentId: c.parentId,
    name: c.name,
    color: c.color,
    sortOrder: c.sortOrder,
    isSystem: c.isSystem,
    kind: c.kind as 'expense' | 'income',
    createdAt: c.createdAt.toISOString(),
  };
}

@Injectable()
export class CategoryService {
  // ── Seeding ───────────────────────────────────────────────────────────────

  async seedDefaults(householdId: string): Promise<void> {
    for (const cat of DEFAULT_CATEGORIES) {
      const parent = await prisma.category.create({
        data: {
          householdId,
          name: cat.name,
          color: cat.color,
          kind: cat.kind,
          isSystem: cat.isSystem,
          sortOrder: cat.sortOrder,
        },
      });
      for (const child of cat.children) {
        await prisma.category.create({
          data: {
            householdId,
            parentId: parent.id,
            name: child.name,
            kind: cat.kind,
            isSystem: false,
            sortOrder: child.sortOrder,
          },
        });
      }
    }
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async listCategories(householdId: string) {
    const rows = await prisma.category.findMany({
      where: { householdId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // Return parents with inline children array
    const parents = rows.filter((r) => !r.parentId);
    const childrenMap = new Map<string, typeof rows>();
    for (const r of rows) {
      if (r.parentId) {
        const list = childrenMap.get(r.parentId) ?? [];
        list.push(r);
        childrenMap.set(r.parentId, list);
      }
    }
    return parents.map((p) => ({
      ...toResponse(p),
      children: (childrenMap.get(p.id) ?? []).map(toResponse),
    }));
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createCategory(householdId: string, body: CreateCategoryBody): Promise<CategoryResponse> {
    if (body.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: body.parentId } });
      if (!parent || parent.householdId !== householdId) {
        throw new NotFoundException('Parent category not found');
      }
      if (parent.parentId) {
        throw new BadRequestException('Sub-categories cannot have sub-categories (max 2 levels)');
      }
    }

    const maxOrder = await prisma.category.aggregate({
      where: { householdId, parentId: body.parentId ?? null },
      _max: { sortOrder: true },
    });
    const sortOrder = body.sortOrder ?? (maxOrder._max.sortOrder ?? -1) + 1;

    const cat = await prisma.category.create({
      data: {
        householdId,
        name: body.name,
        parentId: body.parentId ?? null,
        color: body.color ?? null,
        sortOrder,
        kind: body.kind ?? (body.parentId ? undefined : 'expense'),
      },
    });
    return toResponse(cat);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateCategory(
    id: string,
    householdId: string,
    body: UpdateCategoryBody,
  ): Promise<CategoryResponse> {
    const cat = await this.findOwned(id, householdId);
    if (cat.isSystem && body.name !== undefined) {
      throw new ForbiddenException('System categories cannot be renamed');
    }

    if (body.parentId !== undefined) {
      if (body.parentId !== null) {
        const parent = await prisma.category.findUnique({ where: { id: body.parentId } });
        if (!parent || parent.householdId !== householdId) {
          throw new NotFoundException('Parent category not found');
        }
        if (parent.parentId) {
          throw new BadRequestException('Cannot nest deeper than 2 levels');
        }
        if (body.parentId === id) {
          throw new BadRequestException('A category cannot be its own parent');
        }
      }
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      },
    });
    return toResponse(updated);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteCategory(id: string, householdId: string, body: DeleteCategoryBody): Promise<void> {
    const cat = await this.findOwned(id, householdId);
    if (cat.isSystem) {
      throw new ForbiddenException('System categories cannot be deleted');
    }

    // Check for children
    const childCount = await prisma.category.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new ConflictException(
        `This category has ${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'}. Delete or reassign them first.`,
      );
    }

    // Check for transactions
    const txCount = await prisma.transaction.count({ where: { categoryId: id } });
    if (txCount > 0 && body.reassignTo === undefined) {
      throw new ConflictException(
        JSON.stringify({
          code: 'CATEGORY_HAS_TRANSACTIONS',
          transactionCount: txCount,
          message: `${txCount} transaction${txCount === 1 ? '' : 's'} use this category. Provide reassignTo to proceed.`,
        }),
      );
    }

    if (txCount > 0) {
      // reassignTo: string → move to that category; null → set uncategorized
      if (body.reassignTo) {
        const target = await prisma.category.findUnique({ where: { id: body.reassignTo } });
        if (!target || target.householdId !== householdId) {
          throw new NotFoundException('Reassign target category not found');
        }
      }
      await prisma.transaction.updateMany({
        where: { categoryId: id },
        data: { categoryId: body.reassignTo ?? null },
      });
    }

    // Delete rules pointing at this category (cascade handled by schema, but be explicit)
    await prisma.categoryRule.deleteMany({ where: { categoryId: id } });
    await prisma.category.delete({ where: { id } });
  }

  // ── Category rules ────────────────────────────────────────────────────────

  async listRules(householdId: string): Promise<CategoryRuleResponse[]> {
    const rules = await prisma.categoryRule.findMany({
      where: { householdId },
      include: { category: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rules.map((r) => ({
      id: r.id,
      householdId: r.householdId,
      merchantMatch: r.merchantMatch,
      categoryId: r.categoryId,
      categoryName: r.category.name,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createRule(
    householdId: string,
    userId: string,
    body: CreateCategoryRuleBody,
  ): Promise<CategoryRuleResponse> {
    await this.findOwned(body.categoryId, householdId);
    const normalized = normalizeMerchant(body.merchantMatch);
    if (!normalized) throw new BadRequestException('merchantMatch is empty after normalization');

    // Upsert — one rule per normalized match per household
    const existing = await prisma.categoryRule.findFirst({
      where: { householdId, merchantMatch: normalized },
    });
    let rule;
    if (existing) {
      rule = await prisma.categoryRule.update({
        where: { id: existing.id },
        data: { categoryId: body.categoryId, createdByUserId: userId },
        include: { category: { select: { name: true } } },
      });
    } else {
      rule = await prisma.categoryRule.create({
        data: {
          householdId,
          merchantMatch: normalized,
          categoryId: body.categoryId,
          createdByUserId: userId,
        },
        include: { category: { select: { name: true } } },
      });
    }
    return {
      id: rule.id,
      householdId: rule.householdId,
      merchantMatch: rule.merchantMatch,
      categoryId: rule.categoryId,
      categoryName: rule.category.name,
      createdAt: rule.createdAt.toISOString(),
    };
  }

  async deleteRule(id: string, householdId: string): Promise<void> {
    const rule = await prisma.categoryRule.findUnique({ where: { id } });
    if (!rule || rule.householdId !== householdId) throw new NotFoundException('Rule not found');
    await prisma.categoryRule.delete({ where: { id } });
  }

  // Applies rules to a normalized merchant string — returns matching categoryId or null.
  async applyRules(householdId: string, merchantRaw: string | null | undefined): Promise<string | null> {
    if (!merchantRaw) return null;
    const normalized = normalizeMerchant(merchantRaw);
    if (!normalized) return null;

    const rules = await prisma.categoryRule.findMany({ where: { householdId } });
    for (const rule of rules) {
      if (normalized.includes(rule.merchantMatch)) return rule.categoryId;
    }
    return null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async findOwned(id: string, householdId: string) {
    const cat = await prisma.category.findUnique({ where: { id } });
    if (!cat || cat.householdId !== householdId) throw new NotFoundException('Category not found');
    return cat;
  }
}
