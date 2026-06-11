import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { MfaModule } from './mfa/mfa.module';
import { PrivacyModule } from './privacy/privacy.module';
import { AdminModule } from './admin/admin.module';
import { HouseholdModule } from './household/household.module';

@Module({
  imports: [
    // Rate limiting — 100 req/min per IP globally
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    EmailModule,
    AuthModule,
    MfaModule,
    PrivacyModule,
    AdminModule,
    HouseholdModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
