import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SiteAdminGuard } from './guards/site-admin.guard';
import { AdminService } from './admin.service';
import type { AccessTokenPayload } from '@pfm/contracts';

const RegistrationModeValues = ['admin_invite', 'beta_invite', 'open'] as const;
const PolicySchema = z.object({
  mode: z.enum(RegistrationModeValues),
  householdInviteQuota: z.number().int().min(1).max(50).optional(),
});
const InviteSchema = z.object({ email: z.string().email() });

@Controller('admin')
@UseGuards(SiteAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ── Registration policy ──────────────────────────────────────────────────

  @Get('registration-policy')
  async getPolicy() {
    return ok(await this.admin.getPolicy());
  }

  @Patch('registration-policy')
  async setPolicy(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(PolicySchema)) body: z.infer<typeof PolicySchema>,
  ) {
    return ok(await this.admin.setPolicy(body.mode, user.sub, body.householdInviteQuota));
  }

  // ── Signup invites ────────────────────────────────────────────────────────

  @Get('signup-invites')
  async listInvites() {
    return ok(await this.admin.listInvites());
  }

  @Post('signup-invites')
  async createInvite(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(InviteSchema)) body: z.infer<typeof InviteSchema>,
  ) {
    return ok(await this.admin.createInvite(body.email, user.sub));
  }

  @Post('signup-invites/:id/resend')
  @HttpCode(200)
  async resendInvite(@Param('id') id: string) {
    await this.admin.resendInvite(id);
    return ok({ resent: true });
  }

  @Delete('signup-invites/:id')
  @HttpCode(200)
  async revokeInvite(@Param('id') id: string) {
    await this.admin.revokeInvite(id);
    return ok({ revoked: true });
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  @Get('users')
  async listUsers() {
    return ok(await this.admin.listUsers());
  }

  @Patch('users/:id/site-admin')
  @HttpCode(200)
  async setSiteAdmin(
    @Param('id') id: string,
    @CurrentUser() actor: AccessTokenPayload,
    @Body(new ZodValidationPipe(z.object({ isSiteAdmin: z.boolean() }))) body: { isSiteAdmin: boolean },
  ) {
    return ok(await this.admin.setSiteAdmin(id, actor.sub, body.isSiteAdmin));
  }
}
