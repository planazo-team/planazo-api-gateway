import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { accessLog } from './observability/access-log';
import { medirHttp, servidorDeMetricas } from './observability/metrics';
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

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Detrás del proxy de la plataforma: req.ip es la IP que agregó el proxy (último salto),
  // no lo que el cliente escriba en X-Forwarded-For. Lo usan el rate limit, el detector
  // de ataques y la bitácora. TRUST_PROXY_HOPS=0 lo apaga (por ejemplo, sin proxy en local).
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  app.use(accessLog());
  app.use(medirHttp());
  app.enableCors({
    origin: allowedOrigins(),
    credentials: true,
    exposedHeaders: ['x-served-by', 'x-upstream-served-by', 'x-request-id'],  });
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
  servidorDeMetricas();
  console.log(`api-gateway escuchando en :${port}`);
}
bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
