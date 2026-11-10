import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Logger,
  NotFoundException,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createPlace, googleAccount, ownedPlaceId, type Who } from './booking.client';
import { verificarGoogle } from './google';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SEED_USERS, type Role } from './seed-users';

/** Un ID token de Google es un JWT de ~1 KB; se corta antes de mandarlo a verificar. */
const MAX_CREDENCIAL = 4096;

/** Compara la llave de /demo sin filtrar por tiempos cuánto de ella acertó quien llama. */
function llaveValida(dada: string | undefined, esperada: string): boolean {
  const a = Buffer.from(dada ?? '');
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
   * POST /api/auth/google { credential, role? } → { token, user }
   *
   * Se entra únicamente con Google. El navegador manda el ID token que le dio
   * «Iniciar sesión con Google» y aquí se verifica (firma, emisor, audiencia,
   * expiración y correo verificado). booking guarda la cuenta por el `sub` de
   * Google. La primera vez la persona elige si viene a salir o tiene un
   * negocio: sin `role` se responde 409 ROL_REQUERIDO y el navegador vuelve a
   * mandar el mismo token con el rol elegido. Desde ahí el rol queda guardado
   * y es el que va en el token, sin importar lo que mande el navegador.
   */
  @Post('google')
  @HttpCode(200)
  async google(@Body() body: { credential?: unknown; role?: unknown }) {
    const credential = typeof body?.credential === 'string' ? body.credential : '';
    if (!credential || credential.length > MAX_CREDENCIAL) {
      throw new BadRequestException({ code: 'CREDENCIAL_INVALIDA', message: 'Falta la credencial de Google.' });
    }
    if (body?.role !== undefined && body.role !== 'cliente' && body.role !== 'negocio') {
      throw new BadRequestException({ code: 'ROL_INVALIDO', message: 'El rol debe ser cliente o negocio.' });
    }
    const rolElegido = body?.role as Role | undefined;

    const v = await verificarGoogle(credential);
    // `in` y no `!v.ok`: el proyecto compila sin strictNullChecks y así no se estrecha la unión.
    if ('code' in v) {
      if (v.code === 'SIN_CONFIGURAR') {
        this.logger.error('Falta GOOGLE_CLIENT_ID: no se puede verificar el inicio de sesión con Google.');
        throw new ServiceUnavailableException({ code: 'GOOGLE_NO_CONFIGURADO', message: 'El inicio de sesión no está disponible en este momento.' });
      }
      throw new UnauthorizedException(
        v.code === 'CORREO_NO_VERIFICADO'
          ? { code: v.code, message: 'Tu cuenta de Google no tiene el correo verificado.' }
          : { code: v.code, message: 'No pudimos verificar tu cuenta de Google. Intenta de nuevo.' },
      );
    }

    // La cuenta la guarda booking. Si no responde se reintenta una vez.
    const id = { googleSub: v.id.sub, email: v.id.email, name: v.id.name };
    let r = await googleAccount(id, rolElegido);
    if (!r.ok && r.status !== 400) {
      await new Promise((ok) => setTimeout(ok, 1_000));
      r = await googleAccount(id, rolElegido);
    }
    if (r.status === 400) throw new HttpException(r.data as object, 400);
    if (!r.ok || !r.accountId) {
      this.logger.warn(`No se pudo leer la cuenta de Google en booking (status ${r.status}).`);
      throw new ServiceUnavailableException({
        code: 'SERVICIO_NO_DISPONIBLE',
        message: 'No pudimos abrir tu cuenta en este momento. Intenta de nuevo en unos segundos.',
      });
    }
    if (!r.role) {
      throw new ConflictException({ code: 'ROL_REQUERIDO', message: '¿Vienes a salir o tienes un negocio?', name: r.name });
    }

    const who: Who = { sub: `${r.role === 'negocio' ? 'n' : 'c'}-${r.accountId}`, name: r.name ?? v.id.name, role: r.role };
    if (who.role === 'negocio') {
      const placeId = await ownedPlaceId(who);
      if (placeId) who.placeId = placeId;
    }
    return this.session(who);
  }

  /**
   * POST /api/auth/demo { userId } → { token }. Usuarios semilla para k6 y las
   * pruebas automáticas. Como el único login es Google, esta puerta solo
   * existe si DEMO_LOGIN_KEY está definida, y exige esa llave en `x-demo-key`.
   */
  @Post('demo')
  demo(@Body('userId') userId: string, @Headers('x-demo-key') llave?: string) {
    const esperada = process.env.DEMO_LOGIN_KEY;
    if (!esperada) throw new NotFoundException({ code: 'NO_ENCONTRADO', message: 'Ruta no encontrada.' });
    if (!llaveValida(llave, esperada)) throw new UnauthorizedException({ code: 'LLAVE_DEMO_INVALIDA', message: 'Llave de demo inválida.' });
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
