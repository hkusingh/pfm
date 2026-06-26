import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccessTokenPayload } from '@pfm/contracts';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks all mutating requests (POST/PATCH/PUT/DELETE) for demo sessions.
 * Runs after JwtAuthGuard (which populates req.user) and MfaEnrolledGuard.
 * Public routes are always allowed (they have no user context anyway).
 */
@Injectable()
export class DemoReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: AccessTokenPayload; method: string }>();
    if (!req.user?.isDemo) return true;
    if (READ_METHODS.has(req.method.toUpperCase())) return true;

    throw new ForbiddenException('Demo mode is read-only. Log in to make changes.');
  }
}
