import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { ValidationPipe } from '@nestjs/common';
import { getAllowedFrontendOrigins } from './common/frontend-origin.js';
import { validateAuditSecret } from './bids/bid-audit.utils.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  validateAuditSecret();

  app.enableCors({ origin: getAllowedFrontendOrigins() });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Verzel Leilões API')
    .setDescription('Leilões, lotes, carteira e lances. Eventos WebSocket e regras de estado estão documentados no README.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
