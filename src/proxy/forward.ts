import axios from 'axios';
import type { Request, Response } from 'express';

interface GatewayUser {
  sub: string;
  name?: string;
  role: 'cliente' | 'negocio';
  placeId?: string;
}

/** Cuánto se espera a un servicio antes de responder 502. */
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 10_000);

export interface ForwardOptions {
  /** Prefijo que el servicio pone a sus rutas, p. ej. `/api/v1` en game (Java). */
  upstreamPrefix?: string;
  /**
   * Reenvía también `Authorization: Bearer <jwt>`. Lo necesita game, que valida
   * el mismo JWT por su cuenta (HS256, mismo secreto) en vez de leer `x-user-*`.
   */
  passToken?: boolean;
}

/**
 * Reenvía la petición al servicio dueño de la ruta, quitando el prefijo /api
 * (booking/promo exponen sus rutas sin ese prefijo) y pasando quién es
 * el usuario en headers, ya verificado por el gateway.
 *
 * Seguridad: los headers `x-user-*` los pone SIEMPRE el gateway a partir del JWT;
 * lo que haya mandado el cliente con ese nombre se descarta. Además viaja
 * `x-gateway-key`, un secreto compartido con los servicios, para que ninguno
 * acepte peticiones que no vengan de aquí aunque su URL sea pública.
 */
export async function forward(base: string, req: Request, res: Response, opts: ForwardOptions = {}) {
  const path = req.originalUrl.replace(/^\/api/, '');
  const url = `${base}${opts.upstreamPrefix ?? ''}${path}`;
  const user = (req as Request & { user?: GatewayUser }).user;
  const token = opts.passToken && req.headers.authorization ? { authorization: req.headers.authorization } : {};

  try {
    const upstream = await axios.request({
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
        'x-request-id': (req.headers['x-request-id'] as string) ?? cryptoRandomId(),
        ...token,
      },
      validateStatus: () => true,
    });
    res.status(upstream.status).json(upstream.data);
  } catch {
    res.status(502).json({
      code: 'SERVICIO_NO_DISPONIBLE',
      message: `No se pudo contactar el servicio (${base}).`,
    });
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
