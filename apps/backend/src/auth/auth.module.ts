import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SystemUserService } from './system-user.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SystemUserService],
})
export class AuthModule {}
