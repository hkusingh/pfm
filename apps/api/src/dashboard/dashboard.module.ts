import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { EncryptionModule } from '../common/encryption.module';

@Module({
  imports: [EncryptionModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
