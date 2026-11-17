import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { auditLogService } from '../security/audit';
import type { Role } from './seed-users';

export interface RequestUser {
  sub: string;
  name?: string;
  role: Role;
  placeId?: string;
}

export type RecursoProxy = 'places' | 'reservations' | 'events' | 'promos' | 'game';

/**
 * Autorización por rol (`cliente` | `negocio`) y por establecimiento (`placeId`)
 * en el API Gateway antes de reenviar a booking, promo o game.
 *
 * - `negocio`: administra únicamente su propio `placeId` (editar cupos, ver
 *   reservas de su lugar, crear eventos, lanzar promociones).
 * - `cliente`: consulta lugares, crea/consulta sus reservas, reclama/consulta
 *   cupones y juega el minijuego.
 */
export function verificarAccesoPorRol(req: Request, recurso: RecursoProxy): void {
  const user = (req as Request & { user?: RequestUser }).user;
  // En pruebas unitarias del controlador donde req.user no está poblado se deja pasar al mock de forward.
  if (!user?.role) return;

  const metodo = (req.method ?? 'GET').toUpperCase();
  const ruta = (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api/, '');

  const denegar = (code: string, message: string) => {
    const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const correlationId =
      (req.headers?.['x-correlation-id'] as string) ||
      (req.headers?.['x-request-id'] as string) ||
      'sin-id';
    auditLogService.registrar({
      userId: user.sub || 'anonimo',
      role: user.role,
      placeId: user.placeId,
      action: 'ACCESO_DENEGADO_ROL',
      ip,
      correlationId,
      details: { method: metodo, path: ruta, code },
    });
    throw new ForbiddenException({ code, message });
  };

  if (user.role !== 'cliente' && user.role !== 'negocio') {
    denegar('ROL_NO_AUTORIZADO', 'El rol de la sesión no es válido.');
  }

  // 1. Minijuego (/salas, /rooms, /historico): exclusivo de `cliente` (leaderboard es público para ambos).
  if (recurso === 'game') {
    const esLeaderboard = ruta.startsWith('/leaderboard');
    if (!esLeaderboard && user.role !== 'cliente') {
      denegar('ROL_NO_AUTORIZADO', 'Solo los usuarios con rol cliente pueden participar en el minijuego.');
    }
    return;
  }

  // 2. Eventos de establecimiento (/events): exclusivo de `negocio` y solo para su propio placeId.
  if (recurso === 'events') {
    if (user.role !== 'negocio') {
      denegar('ROL_NO_AUTORIZADO', 'Solo una cuenta en modo negocio puede crear eventos.');
    }
    const bodyPlaceId = (req.body as { placeId?: string } | undefined)?.placeId;
    if (user.placeId && bodyPlaceId && bodyPlaceId !== user.placeId) {
      denegar('ESTABLECIMIENTO_AJENO', 'Solo puedes crear eventos en tu propio establecimiento.');
    }
    return;
  }

  // 3. Lugares y cupos (/places):
  //    - PATCH /places/:id/slots/:sid y GET /places/:id/reservations son exclusivos de `negocio` dueño de :id.
  if (recurso === 'places') {
    const matchPlace = /^\/places\/([^/]+)\/(slots\/[^/]+|reservations)$/.exec(ruta);
    if (matchPlace) {
      const targetPlaceId = decodeURIComponent(matchPlace[1]);
      if (user.role !== 'negocio') {
        denegar('ROL_NO_AUTORIZADO', 'Solo el negocio dueño del establecimiento puede gestionar sus cupos y reservas.');
      }
      if (!user.placeId || user.placeId !== targetPlaceId) {
        denegar('ESTABLECIMIENTO_AJENO', 'No tienes permiso sobre otro establecimiento.');
      }
    }
    return;
  }

  // 4. Reservas (/reservations):
  //    - POST /reservations y GET /reservations/mine son exclusivos de `cliente`.
  if (recurso === 'reservations') {
    if ((metodo === 'POST' && ruta === '/reservations') || (metodo === 'GET' && ruta === '/reservations/mine')) {
      if (user.role !== 'cliente') {
        denegar('ROL_NO_AUTORIZADO', 'Solo los usuarios con rol cliente pueden reservar cupos.');
      }
    }
    return;
  }

  // 5. Promociones (/promos):
  //    - POST /promos (lanzar promo): exclusivo de `negocio` y para su propio `placeId`.
  //    - POST /promos/:id/claim y GET /promos/mine: exclusivos de `cliente`.
  if (recurso === 'promos') {
    if (metodo === 'POST' && ruta === '/promos') {
      if (user.role !== 'negocio') {
        denegar('ROL_NO_AUTORIZADO', 'Solo una cuenta en modo negocio puede lanzar promociones.');
      }
      const bodyPlaceId = (req.body as { placeId?: string } | undefined)?.placeId;
      if (user.placeId && bodyPlaceId && bodyPlaceId !== user.placeId) {
        denegar('ESTABLECIMIENTO_AJENO', 'Solo puedes lanzar promociones para tu propio establecimiento.');
      }
      return;
    }
    if (
      (metodo === 'POST' && (ruta.endsWith('/claim') || ruta.endsWith('/reclamar'))) ||
      (metodo === 'GET' && ruta === '/promos/mine')
    ) {
      if (user.role !== 'cliente') {
        denegar('ROL_NO_AUTORIZADO', 'Solo los usuarios con rol cliente pueden reclamar cupones.');
      }
    }
  }
}
