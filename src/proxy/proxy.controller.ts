import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { verificarAccesoPorRol } from '../auth/role-auth';
import { forward } from './forward';

/**
 * Un método por prefijo de ruta, tal como los define docs/arquitectura.md:
 *   /places, /reservations, /events  → booking
 *   /promos                          → promo
 *   /rooms                           → game
 *
 * Antes de reenviar cada petición se verifica la autorización según el rol
 * (`cliente` | `negocio`) y el `placeId` del establecimiento.
 */
@UseGuards(JwtAuthGuard)
@Controller()
export class ProxyController {
  private readonly bookingUrl = (process.env.BOOKING_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  private readonly promoUrl = (process.env.PROMO_URL ?? 'http://localhost:3002').replace(/\/$/, '');
  private readonly gameUrl = (process.env.GAME_URL ?? 'http://localhost:3003').replace(/\/$/, '');

  @All(['places', 'places/*splat'])
  places(@Req() req: Request, @Res() res: Response) {
    verificarAccesoPorRol(req, 'places');
    return forward(this.bookingUrl, req, res);
  }

  @All(['reservations', 'reservations/*splat'])
  reservations(@Req() req: Request, @Res() res: Response) {
    verificarAccesoPorRol(req, 'reservations');
    return forward(this.bookingUrl, req, res);
  }

  @All(['events', 'events/*splat'])
  events(@Req() req: Request, @Res() res: Response) {
    verificarAccesoPorRol(req, 'events');
    return forward(this.bookingUrl, req, res);
  }

  @All(['promos', 'promos/*splat'])
  promos(@Req() req: Request, @Res() res: Response) {
    verificarAccesoPorRol(req, 'promos');
    return forward(this.promoUrl, req, res);
  }

  @All(['rooms', 'rooms/*splat'])
  rooms(@Req() req: Request, @Res() res: Response) {
    verificarAccesoPorRol(req, 'game');
    return forward(this.gameUrl, req, res);
  }

  /**
   * API REST del minijuego en Java (planazo-game): /api/salas → GAME_URL/api/v1/salas.
   * Game valida el JWT por su cuenta, así que se le reenvía el token.
   */
  @All(['salas', 'salas/*splat', 'leaderboard', 'leaderboard/*splat', 'historico', 'historico/*splat'])
  game(@Req() req: Request, @Res() res: Response) {
    verificarAccesoPorRol(req, 'game');
    return forward(this.gameUrl, req, res, { upstreamPrefix: '/api/v1', passToken: true });
  }
}
