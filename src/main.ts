import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get config service
  const configService = app.get(ConfigService);

  // Enable CORS
  app.enableCors({
    origin: '*', // Configure this properly in production
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Create uploads directories if they don't exist
  const uploadsDir = './uploads';
  const avatarsDir = './uploads/avatars';
  const mediaDir = './uploads/media';

  [uploadsDir, avatarsDir, mediaDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Get port from config
  const port = configService.get('PORT') || 3000;

  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📡 WebSocket server is running on: ws://localhost:${port}`);
}

bootstrap();
