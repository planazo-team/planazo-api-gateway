import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { AttackDetector } from './security/attack-detector';
import { auditLogService } from './security/audit';

/**
 * Orígenes que pueden llamar al gateway desde un navegador.
 * En local: el frontend en :3000. En producción: la URL de Vercel (y sus previews si se quiere).
 * Se separan por coma en ALLOWED_ORIGINS. Un `*` permite todo (solo para depurar).
 */
function allowedOrigins(): string[] | boolean {
  const raw = process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000';
  if (raw.trim() === '*') return true;
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

/** En producción no se arranca con secretos de desarrollo: mejor caerse al inicio que firmar tokens débiles. */
function assertProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  // JWT_SECRET pide 32: game (Java/Nimbus) rechaza claves HS256 de menos de 256 bits.
  const minimo: Record<string, number> = { JWT_SECRET: 32, GATEWAY_KEY: 16 };
  const missing = Object.keys(minimo).filter((k) => !process.env[k] || process.env[k]!.length < minimo[k]);
  if (missing.length) {
    throw new Error(
      `Faltan secretos obligatorios en producción (JWT_SECRET ≥ 32 caracteres, GATEWAY_KEY ≥ 16): ${missing.join(', ')}`,
    );
  }
}

async function bootstrap() {
  assertProductionSecrets();

  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: allowedOrigins(), credentials: true });
  app.use(helmet());

  const attackDetector = new AttackDetector();
  app.use(attackDetector.middleware());
  app.use(auditLogService.middleware());

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 100),
      standardHeaders: true,
      legacyHeaders: false,
      message: { code: 'RATE_LIMIT', message: 'Demasiadas peticiones, espera un momento.' },
    }),
  );
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 8080;
  await app.listen(port);
  console.log(`api-gateway escuchando en :${port}`);
}
bootstrap();
