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
import {
  CreateHouseholdBodySchema,
  UpdateHouseholdBodySchema,
  InviteMemberBodySchema,
  UpdateMemberRoleBodySchema,
} from '@pfm/contracts';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AccessTokenPayload } from '@pfm/contracts';
import { HouseholdService } from './household.service';

@Controller()
export class HouseholdController {
  constructor(private readonly service: HouseholdService) {}

  // ─── E1.1 Create household ─────────────────────────────────────────────────

  @Post('households')
  async createHousehold(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(CreateHouseholdBodySchema)) body: unknown,
  ) {
    const result = await this.service.createHousehold(
      user.sub,
      body as Parameters<typeof this.service.createHousehold>[1],
    );
    return ok(result);
  }

  // ─── E1.5 Household settings ───────────────────────────────────────────────

  @Get('households/me')
  async getMyHousehold(@CurrentUser() user: AccessTokenPayload) {
    const result = await this.service.getMyHousehold(user.sub);
    return ok(result);
  }

  @Get('households/:id')
  async getHousehold(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') householdId: string,
  ) {
    const result = await this.service.getHousehold(householdId, user.sub);
    return ok(result);
  }

  @Patch('households/:id')
  async updateHousehold(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') householdId: string,
    @Body(new ZodValidationPipe(UpdateHouseholdBodySchema)) body: unknown,
  ) {
    const result = await this.service.updateHousehold(
      householdId,
      user.sub,
      body as Parameters<typeof this.service.updateHousehold>[2],
    );
    return ok(result);
  }

  @Get('households/:id/members')
  async getMembers(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') householdId: string,
  ) {
    const result = await this.service.getMembers(householdId, user.sub);
    return ok(result);
  }

  // ─── E1.2 Invite member ────────────────────────────────────────────────────

  @Post('households/:id/invites')
  async inviteMember(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') householdId: string,
    @Body(new ZodValidationPipe(InviteMemberBodySchema)) body: unknown,
  ) {
    const result = await this.service.inviteMember(
      householdId,
      user.sub,
      body as Parameters<typeof this.service.inviteMember>[2],
    );
    return ok(result);
  }

  @Get('households/:id/invites')
  async listInvites(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') householdId: string,
  ) {
    const result = await this.service.listInvites(householdId, user.sub);
    return ok(result);
  }

  @Post('households/:id/invites/:inviteId/resend')
  @HttpCode(200)
  async resendInvite(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') householdId: string,
    @Param('inviteId') inviteId: string,
  ) {
    await this.service.resendInvite(householdId, inviteId, user.sub);
    return ok({ sent: true });
  }

  @Delete('households/:id/invites/:inviteId')
  @HttpCode(200)
  async revokeInvite(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') householdId: string,
    @Param('inviteId') inviteId: string,
  ) {
    await this.service.revokeInvite(householdId, inviteId, user.sub);
    return ok({ revoked: true });
  }

  // ─── E1.3 Accept invite ────────────────────────────────────────────────────

  @Public()
  @Get('invites/:token')
  async getInviteDetails(@Param('token') token: string) {
    const result = await this.service.getInviteDetails(token);
    return ok(result);
  }

  @Post('invites/:token/accept')
  @HttpCode(200)
  async acceptInvite(
    @CurrentUser() user: AccessTokenPayload,
    @Param('token') token: string,
  ) {
    const result = await this.service.acceptInvite(token, user.sub);
    return ok(result);
  }

  // ─── E1.4 Manage roles & remove member ────────────────────────────────────

  @Patch('households/:id/members/:userId')
  async updateMemberRole(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') householdId: string,
    @Param('userId') targetUserId: string,
    @Body(new ZodValidationPipe(UpdateMemberRoleBodySchema)) body: unknown,
  ) {
    await this.service.updateMemberRole(
      householdId,
      targetUserId,
      user.sub,
      body as Parameters<typeof this.service.updateMemberRole>[3],
    );
    return ok({ updated: true });
  }

  @Delete('households/:id/members/:userId')
  @HttpCode(200)
  async removeMember(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') householdId: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.service.removeMember(householdId, targetUserId, user.sub);
    return ok({ removed: true });
  }
}
