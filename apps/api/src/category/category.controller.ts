import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CategoryService } from './category.service';
import {
  CreateCategoryBodySchema,
  UpdateCategoryBodySchema,
  DeleteCategoryBodySchema,
  CreateCategoryRuleBodySchema,
} from '@pfm/contracts';
import type { AccessTokenPayload } from '@pfm/contracts';

@Controller('households/:householdId')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  // ── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  async listCategories(@Param('householdId') householdId: string) {
    return ok(await this.categories.listCategories(householdId));
  }

  @Post('categories')
  async createCategory(
    @Param('householdId') householdId: string,
    @Body(new ZodValidationPipe(CreateCategoryBodySchema)) body: z.infer<typeof CreateCategoryBodySchema>,
  ) {
    return ok(await this.categories.createCategory(householdId, body));
  }

  @Patch('categories/:id')
  async updateCategory(
    @Param('householdId') householdId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCategoryBodySchema)) body: z.infer<typeof UpdateCategoryBodySchema>,
  ) {
    return ok(await this.categories.updateCategory(id, householdId, body));
  }

  @Delete('categories/:id')
  @HttpCode(200)
  async deleteCategory(
    @Param('householdId') householdId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeleteCategoryBodySchema)) body: z.infer<typeof DeleteCategoryBodySchema>,
  ) {
    await this.categories.deleteCategory(id, householdId, body);
    return ok({ deleted: true });
  }

  // ── Category rules ────────────────────────────────────────────────────────

  @Get('category-rules')
  async listRules(@Param('householdId') householdId: string) {
    return ok(await this.categories.listRules(householdId));
  }

  @Post('category-rules')
  async createRule(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(CreateCategoryRuleBodySchema)) body: z.infer<typeof CreateCategoryRuleBodySchema>,
  ) {
    return ok(await this.categories.createRule(householdId, user.sub, body));
  }

  @Delete('category-rules/:id')
  @HttpCode(200)
  async deleteRule(
    @Param('householdId') householdId: string,
    @Param('id') id: string,
  ) {
    await this.categories.deleteRule(id, householdId);
    return ok({ deleted: true });
  }
}
