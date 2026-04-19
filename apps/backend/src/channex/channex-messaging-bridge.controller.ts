import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ChannexMessagingBridgeService } from './channex-messaging-bridge.service';
import { LinkGuestPhoneDto } from './dto/link-guest-phone.dto';

@Controller('channex/guests')
export class ChannexMessagingBridgeController {
  constructor(private readonly bridge: ChannexMessagingBridgeService) {}

  @Post(':reservationCode/phone')
  @HttpCode(HttpStatus.NO_CONTENT)
  async linkPhone(@Body() dto: LinkGuestPhoneDto): Promise<void> {
    await this.bridge.linkGuestPhone(dto.tenantId, dto.reservationCode, dto.phone);
  }
}