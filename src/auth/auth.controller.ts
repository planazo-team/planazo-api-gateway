import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
      role: user.role,
      placeId: user.placeId,
    });

    return { token };
  }
}
