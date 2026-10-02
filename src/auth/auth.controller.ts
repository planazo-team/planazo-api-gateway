import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SEED_USERS } from './seed-users';

@Controller('auth')
export class AuthController {
  constructor(private jwt: JwtService) {}

  /** POST /api/auth/demo { userId } → { token }. Sin contraseña: es login de MVP. */
  @Post('demo')
  demo(@Body('userId') userId: string) {
    const user = SEED_USERS.find((u) => u.id === userId);
    if (!user) {
      throw new BadRequestException({ code: 'USUARIO_INVALIDO', message: 'Usuario semilla no encontrado.' });
    }

    const token = this.jwt.sign({
      sub: user.id,
      name: user.name,
      // Game (Java) lee el nombre del jugador de este claim.
      nombre: user.name,
      role: user.role,
      placeId: user.placeId,
    });

    return { token };
  }

  /** GET /api/auth/me → los datos del token vigente, o 401 si falta o expiró. */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request & { user: { sub: string; name: string; role: string; placeId?: string; exp: number } }) {
    const { sub, name, role, placeId, exp } = req.user;
    return { userId: sub, name, role, placeId: placeId ?? null, expiresAt: exp * 1000 };
  }
}
