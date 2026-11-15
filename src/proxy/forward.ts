import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Request, Response } from 'express';
import CircuitBreaker from 'opossum';

interface GatewayUser {
  sub: string;
  name?: string;
  role: 'cliente' | 'negocio';
  placeId?: string;
}

/** Cuánto se espera a un servicio antes de considerar fallo (ESC-04). */
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 5_000);

export interface ForwardOptions {
  /** Prefijo que el servicio pone a sus rutas, p. ej. `/api/v1` en game (Java). */
  upstreamPrefix?: string;
  /**
   * Reenvía también `Authorization: Bearer <jwt>`. Lo necesita game, que valida
   * el mismo JWT por su cuenta (HS256, mismo secreto) en vez de leer `x-user-*`.
   */
  passToken?: boolean;
}

/** Mapa de circuit breakers por URL base del servicio. */
export const breakers = new Map<string, CircuitBreaker<[AxiosRequestConfig], AxiosResponse>>();

/** Obtiene o inicializa el circuit breaker para el servicio destino (ESC-04 Disponibilidad). */
export function getCircuitBreaker(base: string): CircuitBreaker<[AxiosRequestConfig], AxiosResponse> {
  let breaker = breakers.get(base);
  if (!breaker) {
    const breakerOptions: CircuitBreaker.Options = {
      timeout: UPSTREAM_TIMEOUT_MS,
      errorThresholdPercentage: 50,
      resetTimeout: 10_000,
      rollingCountTimeout: 10_000,
    };

    breaker = new CircuitBreaker(async (cfg: AxiosRequestConfig) => {
      const isGet = (cfg.method ?? 'GET').toString().toUpperCase() === 'GET';
      const maxAttempts = isGet ? 2 : 1;
      let lastErr: unknown;

      for (let intento = 1; intento <= maxAttempts; intento++) {
        try {
          return await axios.request(cfg);
        } catch (err) {
          lastErr = err;
          if (intento < maxAttempts) {
            await new Promise((ok) => setTimeout(ok, intento * 150));
          }
        }
      }
      throw lastErr;
    }, breakerOptions);

    breakers.set(base, breaker);
  }
  return breaker;
}

/**
 * Reenvía la petición al servicio dueño de la ruta con Circuit Breaker (opossum)
 * y reintentos automáticos para operaciones GET idempotentes (ESC-04).
 */
export async function forward(base: string, req: Request, res: Response, opts: ForwardOptions = {}) {
  const path = req.originalUrl.replace(/^\/api/, '');
  const url = `${base}${opts.upstreamPrefix ?? ''}${path}`;
  const user = (req as Request & { user?: GatewayUser }).user;
  const token = opts.passToken && req.headers.authorization ? { authorization: req.headers.authorization } : {};

  const config: AxiosRequestConfig = {
    method: req.method as any,
    url,
    data: req.body,
    timeout: UPSTREAM_TIMEOUT_MS,
    headers: {
      'content-type': 'application/json',
      'x-user-id': user?.sub ?? '',
      'x-user-name': encodeURIComponent(user?.name ?? ''),
      'x-user-role': user?.role ?? '',
      'x-user-place-id': user?.placeId ?? '',
      'x-gateway-key': process.env.GATEWAY_KEY ?? '',
      'x-correlation-id': (req.headers['x-correlation-id'] as string) ?? (req.headers['x-request-id'] as string) ?? cryptoRandomId(),
      'x-request-id': (req.headers['x-request-id'] as string) ?? cryptoRandomId(),
      ...token,
    },
    validateStatus: () => true,
  };

  const breaker = getCircuitBreaker(base);

  try {
    const upstream = await breaker.fire(config);
    res.status(upstream.status).json(upstream.data);
  } catch (_err) {
    res.status(503).json({
      code: 'SERVICIO_NO_DISPONIBLE',
      message: `El servicio ${base} no está disponible en este momento.`,
    });
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
