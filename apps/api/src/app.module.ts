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
import { AccountModule } from './account/account.module';
import { CategoryModule } from './category/category.module';
import { TransactionModule } from './transaction/transaction.module';
import { ImportModule } from './import/import.module';
import { DashboardModule } from './dashboard/dashboard.module';

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
    AccountModule,
    CategoryModule,
    TransactionModule,
    ImportModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
