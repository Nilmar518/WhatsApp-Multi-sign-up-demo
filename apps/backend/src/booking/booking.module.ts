import { Module } from '@nestjs/common';
import { ChannexModule } from '../channex/channex.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingPipelineService } from './booking-pipeline.service';

@Module({
  imports: [ChannexModule],
  controllers: [BookingController],
  providers: [BookingService, BookingPipelineService],
})
export class BookingModule {}
