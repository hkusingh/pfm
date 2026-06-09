import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  TotpConfirmBodySchema,
  MfaVerifyBodySchema,
  MfaRecoverBodySchema,
} from '@pfm/contracts';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MfaService } from './mfa.service';
import type { AccessTokenPayload, MfaVerifyBody, MfaRecoverBody, TotpConfirmBody } from '@pfm/contracts';

@Controller('mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  // ─── TOTP ───────────────────────────────────────────────────────────────────

  @Post('totp/setup')
  async totpSetup(@CurrentUser() user: AccessTokenPayload) {
    const data = await this.mfa.initTotpSetup(user.sub);
    return ok(data);
  }

  @Post('totp/confirm')
  @HttpCode(200)
  async totpConfirm(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(TotpConfirmBodySchema)) body: TotpConfirmBody,
  ) {
    await this.mfa.confirmTotpSetup(user.sub, body.code);
    return ok({ enrolled: true });
  }

  // ─── Email MFA ──────────────────────────────────────────────────────────────

  @Post('email/setup')
  @HttpCode(200)
  async emailSetupSend(@CurrentUser() user: AccessTokenPayload) {
    await this.mfa.sendEmailMfaCode(user.sub);
    return ok({ sent: true });
  }

  @Post('email/confirm')
  @HttpCode(200)
  async emailConfirm(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(TotpConfirmBodySchema)) body: TotpConfirmBody,
  ) {
    await this.mfa.confirmEmailMfaSetup(user.sub, body.code);
    return ok({ enrolled: true });
  }

  // ─── Post-login MFA verification ────────────────────────────────────────────

  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(@Body(new ZodValidationPipe(MfaVerifyBodySchema)) body: MfaVerifyBody) {
    const tokens = await this.mfa.verifyMfaChallenge(body);
    return ok(tokens);
  }

  // ─── Recovery ────────────────────────────────────────────────────────────────

  @Public()
  @Post('recover')
  @HttpCode(200)
  async recover(@Body(new ZodValidationPipe(MfaRecoverBodySchema)) body: MfaRecoverBody) {
    const tokens = await this.mfa.recoverViaCode(body);
    return ok(tokens);
  }
}
