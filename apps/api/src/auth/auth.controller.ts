import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  SignupBodySchema,
  LoginBodySchema,
  RefreshBodySchema,
  VerifyEmailBodySchema,
} from '@pfm/contracts';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthService } from './auth.service';
import type { AccessTokenPayload } from '@pfm/contracts';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  async signup(@Body(new ZodValidationPipe(SignupBodySchema)) body: unknown) {
    const result = await this.auth.signup(body as Parameters<typeof this.auth.signup>[0]);
    return ok(result);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(LoginBodySchema)) body: unknown) {
    const result = await this.auth.login(body as Parameters<typeof this.auth.login>[0]);
    return ok(result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodValidationPipe(RefreshBodySchema)) body: unknown) {
    const result = await this.auth.refresh(body as Parameters<typeof this.auth.refresh>[0]);
    return ok(result);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body(new ZodValidationPipe(VerifyEmailBodySchema)) body: unknown) {
    const { token } = body as { token: string };
    await this.auth.verifyEmail(token);
    return ok({ verified: true });
  }

  @Get('me')
  async me(@CurrentUser() user: AccessTokenPayload) {
    const data = await this.auth.getMe(user.sub);
    return ok(data);
  }
}
