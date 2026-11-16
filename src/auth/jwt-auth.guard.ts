import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { registrarActividad } from '../observability/metrics';

/** Exige un JWT válido en `Authorization: Bearer <token>` y lo deja en `req.user`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException({ code: 'SIN_TOKEN', message: 'Falta el token de autenticación.' });
    }

    try {
      const user = this.jwt.verify<{ sub?: string }>(token);
      (req as Request & { user: unknown }).user = user;
      if (user?.sub) registrarActividad(user.sub);
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_INVALIDO', message: 'Token inválido o expirado.' });
    }
  }
}
