import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const logger = new Logger('AuditLog');

export interface AuditRecord {
  id: string;
  at: number;
  userId: string;
  action: string;
  ip: string;
  correlationId: string;
  details?: Record<string, unknown>;
}

/** Registros que se guardan en memoria; los más viejos salen (la copia durable queda en el log). */
export const MAX_REGISTROS_EN_MEMORIA = 5000;

export class AuditLogService {
  // Bitácora append-only en memoria y acotada. Cada registro sale además al log como JSON:
  // esa es la copia durable (la plataforma conserva los logs y la app no puede editarlos).
  private readonly bitacora: AuditRecord[] = [];

  public registrar(record: Omit<AuditRecord, 'id' | 'at'>): AuditRecord {
    const entry: AuditRecord = {
      id: randomUUID(),
      at: Date.now(),
      ...record,
    };

    // Bitácora append-only: nunca se permite modificar ni borrar registros
    this.bitacora.push(Object.freeze(entry));
    if (this.bitacora.length > MAX_REGISTROS_EN_MEMORIA) this.bitacora.shift();

    logger.log(
      `[AUDIT_LOG] accion=${entry.action} usuario=${entry.userId} ip=${entry.ip} corrId=${entry.correlationId}`,
    );

    return entry;
  }

  public listar(): readonly AuditRecord[] {
    return this.bitacora;
  }

  public mapearAccionSensible(method: string, path: string): string | null {
    const m = method.toUpperCase();
    const cleanPath = path.split('?')[0].replace(/\/+$/, '');

    if (m === 'POST' && (cleanPath === '/api/auth/google' || cleanPath === '/api/auth/demo')) {
      return 'INICIO_SESION';
    }
    if (m === 'POST' && cleanPath === '/api/auth/negocio/registro') {
      return 'REGISTRO_NEGOCIO';
    }
    if (m === 'POST' && cleanPath === '/api/auth/modo') {
      return 'CAMBIO_MODO';
    }
    if (m === 'POST' && cleanPath === '/api/auth/2fa/confirmar') {
      return 'ACTIVAR_2FA';
    }
    if (m === 'POST' && (cleanPath === '/api/auth/negocio' || cleanPath === '/api/places')) {
      return 'CREAR_LUGAR';
    }
    if (m === 'POST' && cleanPath.endsWith('/reclamar')) {
      return 'RECLAMAR_CUPON';
    }
    if (m === 'POST' && cleanPath === '/api/promos') {
      return 'CREAR_PROMO';
    }
    if (m === 'PATCH' && cleanPath.startsWith('/api/promos/')) {
      return 'EDITAR_PROMO';
    }
    if (m === 'PATCH' && cleanPath.includes('/slots/')) {
      return 'CAMBIAR_CAPACIDAD';
    }
    if (m === 'POST' && cleanPath === '/api/reservations') {
      return 'CREAR_RESERVA';
    }
    if ((m === 'DELETE' || m === 'POST') && cleanPath.includes('/reservations/')) {
      return 'CANCELAR_RESERVA';
    }

    return null;
  }

  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const accion = this.mapearAccionSensible(req.method, req.originalUrl || req.url);

      if (!accion) {
        return next();
      }

      res.on('finish', () => {
        // Solo auditar si la operación fue procesada sin error del cliente (2xx o 3xx)
        if (res.statusCode >= 200 && res.statusCode < 400) {
          const user = (req as any).user;
          const userId = user?.sub ?? (req.headers['x-user-id'] as string) ?? 'anonimo';
          // IP resuelta por Express con trust proxy (no el X-Forwarded-For que manda el cliente).
          const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
          const correlationId = (req.headers['x-correlation-id'] as string) || (req.headers['x-request-id'] as string) || 'sin-id';

          this.registrar({
            userId,
            action: accion,
            ip,
            correlationId,
            details: {
              method: req.method,
              path: req.originalUrl || req.url,
              status: res.statusCode,
            },
          });
        }
      });

      next();
    };
  }
}

export const auditLogService = new AuditLogService();
