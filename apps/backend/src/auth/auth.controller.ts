import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ExchangeTokenDto } from './dto/exchange-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/exchange-token
   *
   * Accepts the single-use authorization code from the Meta Embedded Signup
   * flow, exchanges it for a long-lived access token, and persists the result
   * to Firestore. The frontend reacts via onSnapshot without polling.
   */
  @Post('exchange-token')
  @HttpCode(HttpStatus.OK)
  exchangeToken(@Body() dto: ExchangeTokenDto) {
    return this.authService.exchangeToken(dto);
  }
}
