import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { REPLICA, SERVICIO, SERVIDO_POR } from './replica';

/** Ids que se aceptan del cliente: cortos y sin caracteres raros (evita inyección en logs). */
const ID_VALIDO = /^[A-Za-z0-9._-]{1,64}$/;

/** Usa el id que mandó el cliente si es válido; si no, genera uno. */
export function idDePeticion(valor: unknown): string {
  return typeof valor === 'string' && ID_VALIDO.test(valor) ? valor : randomUUID();
}

/** Ruta sin query string y sin caracteres de control: lo que se escribe en el log. */
export function rutaSegura(url: string): string {
  return (url.split('?')[0] ?? '').replace(/[^\w\-./:@]/g, '').slice(0, 200);
}

export interface LineaDeAcceso {
  t: string;
  nivel: 'info' | 'warn' | 'error';
  svc: string;
  replica: string;
  rid: string;
  metodo: string;
  ruta: string;
  status: number;
  ms: number;
  upstream?: string;
}

type Escribir = (linea: string) => void;
const aStdout: Escribir = (linea) => {
  process.stdout.write(linea + '\n');
};

function nivelDe(status: number): LineaDeAcceso['nivel'] {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

/**
 * Middleware de observabilidad (ESC-07) y de balanceo (ESC-04):
 * - pone `x-request-id` (y `x-correlation-id` si no venía) para seguir la petición de punta a punta;
 * - responde con `x-served-by: api-gateway@<réplica>` para ver qué réplica atendió;
 * - escribe una línea JSON por petición con réplica, ruta, status, latencia y la réplica del servicio interno.
 */
export function accessLog(escribir: Escribir = aStdout) {
  return (req: Request, res: Response, next: NextFunction) => {
    const inicio = process.hrtime.bigint();
    const rid = idDePeticion(req.headers['x-request-id']);
    req.headers['x-request-id'] = rid;
    const corr = req.headers['x-correlation-id'];
    if (typeof corr !== 'string' || !ID_VALIDO.test(corr)) req.headers['x-correlation-id'] = rid;
    res.setHeader('x-served-by', SERVIDO_POR);
    res.setHeader('x-request-id', rid);

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
      const upstream = res.getHeader('x-upstream-served-by');
      const linea: LineaDeAcceso = {
        t: new Date().toISOString(),
        nivel: nivelDe(res.statusCode),
        svc: SERVICIO,
        replica: REPLICA,
        rid,
        metodo: req.method,
        ruta: rutaSegura(req.originalUrl || req.url || ''),
        status: res.statusCode,
        ms: Math.round(ms * 10) / 10,
        ...(typeof upstream === 'string' ? { upstream } : {}),
      };
      escribir(JSON.stringify(linea));
    });
    next();
  };
}
