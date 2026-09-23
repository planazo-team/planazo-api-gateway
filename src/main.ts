import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: true, credentials: true });
  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: { code: 'RATE_LIMIT', message: 'Demasiadas peticiones, espera un momento.' },
    }),
  );
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 8080;
  await app.listen(port);
  console.log(`api-gateway escuchando en :${port}`);
}
bootstrap();
