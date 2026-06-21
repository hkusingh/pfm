import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  imports: [TransactionModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
