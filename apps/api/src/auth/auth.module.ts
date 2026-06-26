import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MfaEnrolledGuard } from './guards/mfa-enrolled.guard';
import { DemoReadOnlyGuard } from './guards/demo-readonly.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    // Global JWT guard — all routes require auth unless @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global MFA enforcement guard — runs after JWT guard
    { provide: APP_GUARD, useClass: MfaEnrolledGuard },
    // Global demo guard — blocks mutations for isDemo sessions, runs last
    { provide: APP_GUARD, useClass: DemoReadOnlyGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
