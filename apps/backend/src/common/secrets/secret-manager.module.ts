import { Module, Global } from '@nestjs/common';
import { SecretManagerService } from './secret-manager.service';

@Global()
@Module({
  providers: [SecretManagerService],
  exports: [SecretManagerService],
})
export class SecretManagerModule {}
