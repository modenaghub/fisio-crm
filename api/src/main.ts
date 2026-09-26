import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json } from 'express';
import { AppModule } from './app.module';
import { assertProductionSecrets, config } from './common/config';

async function bootstrap() {
  assertProductionSecrets();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Atrás de proxy (nginx / balanceador): usa o IP real do cliente para auditoria e rate limit.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(json({ limit: '1mb' }));
  app.use(cookieParser());
  app.enableCors({ origin: config.webUrl, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  );
  app.enableShutdownHooks();

  await app.listen(config.port);
  Logger.log(`API em http://localhost:${config.port}/api/v1 (${config.isProd ? 'produção' : 'desenvolvimento'})`, 'Bootstrap');
}
bootstrap();
