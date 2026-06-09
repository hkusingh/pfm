import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const request = ctx.switchToHttp().getRequest<Request & { user: unknown }>();
    const token = this.extractBearer(request);
    if (!token) throw new UnauthorizedException('Missing authorization token');

    const payload = await this.tokens.verifyAccessToken(token);
    request.user = payload;
    return true;
  }

  private extractBearer(request: Request): string | null {
    const header = request.headers['authorization'];
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }
}
