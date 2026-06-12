import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportService } from './import.service';
import { ImportCommitBodySchema } from '@pfm/contracts';
import { ok } from '../common/response';

@Controller()
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  // POST /households/:householdId/import/preview
  @Post('households/:householdId/import/preview')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async preview(
    @Param('householdId') householdId: string,
    @Req() req: { user?: { sub: string } },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const userId = req.user?.sub ?? '';
    return ok(await this.importService.preview(householdId, userId, file));
  }

  // POST /households/:householdId/import/commit
  @Post('households/:householdId/import/commit')
  async commit(
    @Param('householdId') householdId: string,
    @Req() req: { user?: { sub: string } },
    @Body() rawBody: unknown,
  ) {
    const parsed = ImportCommitBodySchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors[0]?.message ?? 'Invalid body');
    const userId = req.user?.sub ?? '';
    return ok(await this.importService.commit(householdId, userId, parsed.data));
  }

  // GET /households/:householdId/imports
  @Get('households/:householdId/imports')
  async list(@Param('householdId') householdId: string) {
    return ok(await this.importService.listBatches(householdId));
  }

  // DELETE /households/:householdId/imports/:batchId
  @Delete('households/:householdId/imports/:batchId')
  async deleteBatch(
    @Param('householdId') householdId: string,
    @Param('batchId') batchId: string,
  ) {
    return ok(await this.importService.deleteBatch(batchId, householdId));
  }
}
