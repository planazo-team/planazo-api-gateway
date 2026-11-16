import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { ataquesDetectados } from '../observability/metrics';

const logger = new Logger('AttackDetector');

export interface AttackDetectorOptions {
  redisUrl?: string;
  umbralErrores?: number; // Por defecto: 50
  ventanaSegundos?: number; // Por defecto: 60 s (1 min)
  duracionBloqueoSegundos?: number; // Por defecto: 600 s (10 min)
}

export class AttackDetector {
  private redis: Redis | null = null;
  private readonly umbral: number;
  private readonly ventana: number;
  private readonly bloqueo: number;

  // Fallback en memoria si Redis no está disponible
  private readonly memErrores = new Map<string, { count: number; expiresAt: number }>();
  private readonly memBloqueados = new Map<string, number>();

  constructor(options: AttackDetectorOptions = {}) {
    this.umbral = options.umbralErrores ?? 50;
    this.ventana = options.ventanaSegundos ?? 60;
    this.bloqueo = options.duracionBloqueoSegundos ?? 600;

    const url = options.redisUrl ?? process.env.REDIS_URL ?? process.env.BUS_URL;
    if (url) {
      try {
        this.redis = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        this.redis.on('error', (err: Error) => logger.warn(`Redis (detección de ataques): ${err.message}`));
        this.redis.connect().catch((err) => {
          logger.warn(`No se pudo conectar a Redis para detección de ataques, usando memoria: ${err.message}`);
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  /**
   * IP del cliente tal como la resuelve Express con `trust proxy` (main.ts): la que
   * agregó el proxy de la plataforma. No se lee el primer valor de X-Forwarded-For,
   * porque ese lo escribe el propio cliente y se puede falsificar.
   */
  public obtenerIp(req: Request): string {
    return req.ip || req.socket?.remoteAddress || '127.0.0.1';
  }

  public async estaBloqueada(ip: string): Promise<boolean> {
    if (this.redis) {
      try {
        const existe = await this.redis.exists(`ip:blocked:${ip}`);
        return existe === 1;
      } catch {
        // En caso de fallo de Redis, recurre a memoria
      }
    }

    const exp = this.memBloqueados.get(ip);
    if (!exp) return false;
    if (Date.now() > exp) {
      this.memBloqueados.delete(ip);
      return false;
    }
    return true;
  }

  public async registrarFallo(ip: string): Promise<{ bloqueada: boolean; total: number }> {
    let total = 1;

    if (this.redis) {
      try {
        const key = `ip:err4xx:${ip}`;
        total = await this.redis.incr(key);
        if (total === 1) {
          await this.redis.expire(key, this.ventana);
        }
        if (total > this.umbral) {
          await this.redis.set(`ip:blocked:${ip}`, '1', 'EX', this.bloqueo);
          logger.warn(
            `[ALERTA_SEGURIDAD] Ataque detectado: IP ${ip} bloqueada por ${this.bloqueo / 60} minutos tras registrar ${total} errores 401/429 en 1 minuto.`,
          );
          ataquesDetectados.inc();
          ataquesDetectados.inc();
      return { bloqueada: true, total };
        }
        return { bloqueada: false, total };
      } catch {
        // Recurre a memoria si falla Redis
      }
    }

    const ahora = Date.now();
    const entry = this.memErrores.get(ip);
    if (!entry || ahora > entry.expiresAt) {
      this.memErrores.set(ip, { count: 1, expiresAt: ahora + this.ventana * 1000 });
      total = 1;
    } else {
      entry.count += 1;
      total = entry.count;
    }

    if (total > this.umbral) {
      this.memBloqueados.set(ip, ahora + this.bloqueo * 1000);
      logger.warn(
        `[ALERTA_SEGURIDAD] Ataque detectado: IP ${ip} bloqueada por ${this.bloqueo / 60} minutos tras registrar ${total} errores 401/429 en 1 minuto.`,
      );
      ataquesDetectados.inc();
      return { bloqueada: true, total };
    }

    return { bloqueada: false, total };
  }

  public middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const ip = this.obtenerIp(req);

      const bloqueada = await this.estaBloqueada(ip);
      if (bloqueada) {
        res.status(429).json({
          code: 'IP_BLOQUEADA',
          message: 'Dirección IP bloqueada temporalmente por actividad sospechosa. Intente en 10 minutos.',
        });
        return;
      }

      res.on('finish', () => {
        if (res.statusCode === 401 || res.statusCode === 429) {
          void this.registrarFallo(ip);
        }
      });

      next();
    };
  }

  public cerrar() {
    if (this.redis) {
      try {
        this.redis.disconnect();
      } catch {}
      this.redis = null;
    }
  }
}
