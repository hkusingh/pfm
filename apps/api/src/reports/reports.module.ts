import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { EncryptionModule } from '../common/encryption.module';

@Module({
  imports: [EncryptionModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
