import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  SignupBodySchema,
  LoginBodySchema,
  RefreshBodySchema,
  VerifyEmailBodySchema,
  UpdateProfileBodySchema,
  ChangePasswordBodySchema,
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

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Body(new ZodValidationPipe(z.object({ refreshToken: z.string() }))) body: { refreshToken: string },
  ) {
    await this.auth.logout(body.refreshToken);
    return ok({ loggedOut: true });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(
    @Body(new ZodValidationPipe(z.object({ email: z.string().email() }))) body: { email: string },
  ) {
    await this.auth.forgotPassword(body.email);
    // Always return the same response — don't leak whether the email exists
    return ok({ sent: true });
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodValidationPipe(z.object({ token: z.string(), password: z.string().min(12) })))
    body: { token: string; password: string },
  ) {
    await this.auth.resetPassword(body.token, body.password);
    return ok({ reset: true });
  }

  @Public()
  @Post('demo')
  @HttpCode(200)
  async demo(): Promise<ReturnType<typeof ok>> {
    const result = await this.auth.startDemo();
    return ok(result);
  }

  @Get('me')
  async me(@CurrentUser() user: AccessTokenPayload): Promise<ReturnType<typeof ok>> {
    const data = await this.auth.getMe(user.sub);
    return ok(data);
  }

  @Patch('profile')
  @HttpCode(200)
  async updateProfile(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(UpdateProfileBodySchema)) body: { name: string },
  ): Promise<ReturnType<typeof ok>> {
    const updated = await this.auth.updateProfile(user.sub, body.name);
    return ok(updated);
  }

  @Patch('password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(ChangePasswordBodySchema)) body: { currentPassword: string; newPassword: string },
  ): Promise<ReturnType<typeof ok>> {
    await this.auth.changePassword(user.sub, body.currentPassword, body.newPassword);
    return ok({ changed: true });
  }
}
