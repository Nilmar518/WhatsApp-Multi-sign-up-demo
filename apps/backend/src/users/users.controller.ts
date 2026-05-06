import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get(':uid')
  findOne(@Param('uid') uid: string) {
    return this.users.findOne(uid);
  }

  @Patch(':uid')
  update(@Param('uid') uid: string, @Body() dto: UpdateUserDto) {
    return this.users.update(uid, dto);
  }

  @Delete(':uid')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('uid') uid: string) {
    return this.users.remove(uid);
  }
}
