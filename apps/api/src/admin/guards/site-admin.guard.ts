import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { prisma } from '@pfm/db';
import type { AccessTokenPayload } from '@pfm/contracts';

@Injectable()
export class SiteAdminGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ user: AccessTokenPayload }>();
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { isSiteAdmin: true },
    });
    if (!user?.isSiteAdmin) {
      throw new ForbiddenException('Site admin access required');
    }
    return true;
  }
}
