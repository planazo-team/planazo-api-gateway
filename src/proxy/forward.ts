import axios from 'axios';
import type { Request, Response } from 'express';

interface GatewayUser {
  sub: string;
  role: 'cliente' | 'negocio';
  placeId?: string;
}

/**
 * Reenvía la petición al servicio dueño de la ruta, quitando el prefijo /api
 * (booking/promo/game exponen sus rutas sin ese prefijo) y pasando quién es
 * el usuario en headers, ya verificado por el gateway.
 */
export async function forward(base: string, req: Request, res: Response) {
  const path = req.originalUrl.replace(/^\/api/, '');
  const url = `${base}${path}`;
  const user = (req as Request & { user?: GatewayUser }).user;

  try {
    const upstream = await axios.request({
      method: req.method as any,
      url,
      data: req.body,
      headers: {
        'content-type': 'application/json',
        'x-user-id': user?.sub ?? '',
        'x-user-role': user?.role ?? '',
        'x-user-place-id': user?.placeId ?? '',
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
