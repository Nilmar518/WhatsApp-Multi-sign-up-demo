import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('messages')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  /**
   * POST /messages/send
   *
   * Sends a WhatsApp text message using the Long-Lived token stored in
   * Firestore for the given businessId.
   *
   * ⚠️ IMPORTANT — "User Must Message First" rule:
   * The WhatsApp Cloud API operates on a 24-hour customer service window.
   * A free-form text reply can only be sent AFTER the recipient has
   * initiated a conversation. Attempting to send outside this window
   * returns Meta error 131047. Use a pre-approved template instead.
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  send(@Body() dto: SendMessageDto) {
    return this.messagingService.sendMessage(dto);
  }
}
