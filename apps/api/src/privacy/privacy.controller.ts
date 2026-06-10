import { Body, Controller, Delete, Get, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrivacyService } from './privacy.service';
import type { AccessTokenPayload } from '@pfm/contracts';

const DeleteAccountBodySchema = z.object({
  confirmEmail: z.string().email(),
});

@Controller('user')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('export')
  async exportData(@CurrentUser() user: AccessTokenPayload): Promise<ReturnType<typeof ok>> {
    const data = await this.privacy.exportUserData(user.sub);
    return ok(data);
  }

  @Delete()
  @HttpCode(200)
  async deleteAccount(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(DeleteAccountBodySchema)) body: z.infer<typeof DeleteAccountBodySchema>,
  ): Promise<ReturnType<typeof ok>> {
    const result = await this.privacy.deleteUser(user.sub, body.confirmEmail);
    return ok(result);
  }
}
