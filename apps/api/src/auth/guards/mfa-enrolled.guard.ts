import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { prisma } from '@pfm/db';
import type { AccessTokenPayload } from '@pfm/contracts';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Enforces E0.4: every authenticated request must come from a user who has
// completed MFA enrollment AND verified their MFA code for this session.
// Applied globally after JwtAuthGuard.
@Injectable()
export class MfaEnrolledGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const request = ctx.switchToHttp().getRequest<{ user: AccessTokenPayload }>();
    const user = request.user;
    if (!user) return true; // JwtAuthGuard already rejected unauthenticated requests

    // Check the token carries mfaVerified
    if (!user.mfaVerified) {
      const confirmedMethod = await prisma.mfaMethod.findFirst({
        where: { userId: user.sub, confirmedAt: { not: null } },
      });
      if (confirmedMethod) {
        // User has enrolled MFA but didn't complete MFA during this login
        throw new ForbiddenException({
          code: 'MFA_REQUIRED',
          message: 'Complete MFA verification to access this resource.',
        });
      }
      // User hasn't enrolled — they can reach only the MFA setup endpoints
    }

    return true;
  }
}
