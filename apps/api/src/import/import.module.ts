import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { TransactionModule } from '../transaction/transaction.module';
import { EncryptionModule } from '../common/encryption.module';

@Module({
  imports: [TransactionModule, EncryptionModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
