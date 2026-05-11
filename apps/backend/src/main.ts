import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.setGlobalPrefix('api');
  const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, 'https://pure-highlander-487218-g2.web.app', 'https://pure-highlander-487218-g2.firebaseapp.com']
    : true;
  app.enableCors({ origin: allowedOrigins });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(
    `[PORT ADVISORY] Backend listening on port ${port}. Frontend proxy expected at port 5173 → targeting http://localhost:${port}.`,
  );
}

bootstrap();
