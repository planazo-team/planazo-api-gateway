import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpException, Logger, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { claimAccount, createPlace, ownedPlaceId, type Who } from './booking.client';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SEED_USERS, type Role } from './seed-users';

/** Letras (con tildes), números, espacios y algo de puntuación; de 2 a 30 caracteres. */
const NOMBRE = /^[\p{L}\p{N} .'\-_]{2,30}$/u;
/** Identificador del dispositivo que genera el navegador y guarda en localStorage. */
const DISPOSITIVO = /^[A-Za-z0-9]{8,40}$/;

type AuthedRequest = Request & { user: Who & { exp: number } };

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private jwt: JwtService) {}

  private sign(who: Who): string {
    return this.jwt.sign({
      sub: who.sub,
      name: who.name,
      // Game (Java) lee el nombre del jugador de este claim.
      nombre: who.name,
      role: who.role,
      ...(who.placeId ? { placeId: who.placeId } : {}),
    });
  }

  private session(who: Who) {
    return {
      token: this.sign(who),
      user: { id: who.sub, name: who.name, role: who.role, placeId: who.placeId ?? null },
    };
  }

  /**
   * POST /api/auth/login { name, role, deviceId } → { token, user }
   *
   * Entra cualquiera escribiendo solo su nombre, y cada nombre es único: el
   * primer navegador que lo usa se queda con él (booking lo guarda). Ese
   * navegador vuelve a entrar con su nombre cuando quiera; otro recibe 409
   * NOMBRE_EN_USO con una sugerencia («Juan 2»). Dos nombres en el mismo
   * navegador son dos cuentas: nadie hereda el negocio de otro por compartir
   * computador. El id del token es `c-<cuenta>` o `n-<cuenta>`; si es un
   * negocio que ya creó su lugar, el token lo incluye.
   */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { name?: string; role?: Role; deviceId?: string }) {
    const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ');
    const role: Role = body?.role === 'negocio' ? 'negocio' : 'cliente';
    const deviceId = String(body?.deviceId ?? '');

    if (!NOMBRE.test(name)) {
      throw new BadRequestException({
        code: 'NOMBRE_INVALIDO',
        message: 'Escribe un nombre de 2 a 30 letras (sin símbolos raros).',
      });
    }
    if (!DISPOSITIVO.test(deviceId)) {
      throw new BadRequestException({ code: 'DISPOSITIVO_INVALIDO', message: 'Falta el identificador del dispositivo.' });
    }

    // La cuenta la decide booking. Si no responde, se reintenta una vez y si
    // sigue caído se pide reintentar: entrar «por navegador» mezclaría a dos
    // personas que usan el mismo computador con nombres distintos.
    let r = await claimAccount(name, deviceId);
    if (!r.ok && r.status !== 409 && r.status !== 400) {
      await new Promise((ok) => setTimeout(ok, 1_000));
      r = await claimAccount(name, deviceId);
    }
    if (r.status === 409 || r.status === 400) throw new HttpException(r.data as object, r.status);
    if (!r.ok || !r.accountId) {
      this.logger.warn(`No se pudo reservar el nombre en booking (status ${r.status}).`);
      throw new ServiceUnavailableException({
        code: 'SERVICIO_NO_DISPONIBLE',
        message: 'No pudimos verificar tu nombre en este momento. Intenta de nuevo en unos segundos.',
      });
    }
    const cuenta = r.accountId;
    const nombre = r.name ?? name;

    const who: Who = { sub: `${role === 'negocio' ? 'n' : 'c'}-${cuenta}`, name: nombre, role };
    if (role === 'negocio') {
      const placeId = await ownedPlaceId(who);
      if (placeId) who.placeId = placeId;
    }
    return this.session(who);
  }

  /** POST /api/auth/demo { userId } → { token }. Usuarios semilla: los usan k6 y las demos. */
  @Post('demo')
  demo(@Body('userId') userId: string) {
    const user = SEED_USERS.find((u) => u.id === userId);
    if (!user) {
      throw new BadRequestException({ code: 'USUARIO_INVALIDO', message: 'Usuario semilla no encontrado.' });
    }
    return { token: this.sign({ sub: user.id, name: user.name, role: user.role, placeId: user.placeId }) };
  }

  /** GET /api/auth/me → los datos del token vigente, o 401 si falta o expiró. */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthedRequest) {
    const { sub, name, role, placeId, exp } = req.user;
    return { userId: sub, name, role, placeId: placeId ?? null, expiresAt: exp * 1000 };
  }

  /**
   * POST /api/auth/negocio { name, category, lat, lng, description, priceLevel, cover }
   * → { place, token, user }
   *
   * Un negocio crea su lugar. booking lo guarda y lo anuncia en vivo
   * (`PLACE.CREATED`); aquí se firma un token nuevo con su `placeId`, que es
   * lo que los servicios usan para saber que el panel le pertenece.
   */
  @UseGuards(JwtAuthGuard)
  @Post('negocio')
  @HttpCode(201)
  async crearNegocio(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    const me = req.user;
    if (me.role !== 'negocio') {
      throw new ForbiddenException({ code: 'ROL_NO_AUTORIZADO', message: 'Solo una cuenta de negocio puede crear un lugar.' });
    }
    const r = await createPlace(me, body);
    if (r.status >= 400) throw new HttpException(r.data, r.status);

    const who: Who = { sub: me.sub, name: me.name, role: 'negocio', placeId: String(r.data.id) };
    return { place: r.data, ...this.session(who) };
  }
}
