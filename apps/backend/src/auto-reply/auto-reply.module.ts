import { Module } from '@nestjs/common';
import { AutoReplyController } from './auto-reply.controller';
import { AutoReplyService } from './auto-reply.service';

@Module({
  controllers: [AutoReplyController],
  providers: [AutoReplyService],
})
export class AutoReplyModule {}
