import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { CategoryModule } from '../category/category.module';
import { EncryptionModule } from '../common/encryption.module';

@Module({
  imports: [CategoryModule, EncryptionModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
