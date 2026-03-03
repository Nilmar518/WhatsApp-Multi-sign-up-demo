import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors();
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(
    `[PORT ADVISORY] Backend listening on port ${port}. Frontend proxy expected at port 5173 → targeting http://localhost:${port}.`,
  );
}

bootstrap();
