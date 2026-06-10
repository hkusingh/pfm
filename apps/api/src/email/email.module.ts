import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

// Global so any module can inject EmailService without importing EmailModule explicitly
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
