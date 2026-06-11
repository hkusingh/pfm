import { Module } from '@nestjs/common';
import { HouseholdController } from './household.controller';
import { HouseholdService } from './household.service';
import { EmailModule } from '../email/email.module';
import { CategoryModule } from '../category/category.module';

@Module({
  imports: [EmailModule, CategoryModule],
  controllers: [HouseholdController],
  providers: [HouseholdService],
})
export class HouseholdModule {}
