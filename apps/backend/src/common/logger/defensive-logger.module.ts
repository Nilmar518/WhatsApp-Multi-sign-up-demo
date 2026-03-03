import { Module, Global } from '@nestjs/common';
import { DefensiveLoggerService } from './defensive-logger.service';

@Global()
@Module({
  providers: [DefensiveLoggerService],
  exports: [DefensiveLoggerService],
})
export class DefensiveLoggerModule {}
