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
import { createPlace, cuentaPorId, googleAccount, ownedPlaceId, registrarNegocio, type CuentaGoogle, type Who } from './booking.client';
import { type GoogleIdentity, verificarGoogle } from './google';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SEED_USERS, type Role } from './seed-users';

/** Un ID token de Google es un JWT de ~1 KB; se corta antes de mandarlo a verificar. */
const MAX_CREDENCIAL = 4096;
/** Para registrar un negocio, Google tiene que haber emitido el token hace menos de 10 minutos. */
const EDAD_MAXIMA_REGISTRO_SEG = 600;
/** El id de cuenta de Google va en el token como `c-<id>` o `n-<id>`. */
const SUB_GOOGLE = /^[cn]-(g[A-Z2-9]{12})$/;

type Modo = 'cliente' | 'negocio';

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

  /** `negocio`: si la cuenta tiene el modo negocio activado (para mostrar «Cambiar a modo negocio»). */
  private session(who: Who, negocio = who.role === 'negocio') {
    return {
      token: this.sign(who),
      user: { id: who.sub, name: who.name, role: who.role, placeId: who.placeId ?? null, negocio },
    };
  }

  /** Firma la sesión de una cuenta de Google en el modo pedido. El negocio incluye su lugar, si ya lo creó. */
  private async sesionDeCuenta(cuenta: CuentaGoogle, modo: Modo, nombre: string) {
    const who: Who = { sub: `${modo === 'negocio' ? 'n' : 'c'}-${cuenta.accountId}`, name: cuenta.name || nombre, role: modo };
    if (modo === 'negocio') {
      const placeId = await ownedPlaceId(who);
      if (placeId) who.placeId = placeId;
    }
    return this.session(who, cuenta.negocio === true);
  }

  /** Verifica la credencial de Google y traduce cada falla a una respuesta clara. */
  private async identidad(credential: unknown, opciones: { maxEdadSeg?: number } = {}): Promise<GoogleIdentity> {
    const cred = typeof credential === 'string' ? credential : '';
    if (!cred || cred.length > MAX_CREDENCIAL) {
      throw new BadRequestException({ code: 'CREDENCIAL_INVALIDA', message: 'Falta la credencial de Google.' });
    }
    const v = await verificarGoogle(cred, opciones);
    // `in` y no `!v.ok`: el proyecto compila sin strictNullChecks y así no se estrecha la unión.
    if ('code' in v) {
      if (v.code === 'SIN_CONFIGURAR') {
        this.logger.error('Falta GOOGLE_CLIENT_ID: no se puede verificar el inicio de sesión con Google.');
        throw new ServiceUnavailableException({ code: 'GOOGLE_NO_CONFIGURADO', message: 'El inicio de sesión no está disponible en este momento.' });
      }
      const mensaje: Record<string, string> = {
        CORREO_NO_VERIFICADO: 'Tu cuenta de Google no tiene el correo verificado.',
        CREDENCIAL_VIEJA: 'Por seguridad, vuelve a confirmar con Google para registrar tu negocio.',
        CREDENCIAL_INVALIDA: 'No pudimos verificar tu cuenta de Google. Intenta de nuevo.',
      };
      throw new UnauthorizedException({ code: v.code, message: mensaje[v.code] });
    }
    return v.id;
  }

  /** La cuenta en booking. Si booking no responde se reintenta una vez. */
  private async cuenta(id: GoogleIdentity): Promise<CuentaGoogle> {
    const datos = { googleSub: id.sub, email: id.email, name: id.name };
    let r = await googleAccount(datos);
    if (!r.ok && r.status !== 400) {
      await new Promise((ok) => setTimeout(ok, 1_000));
      r = await googleAccount(datos);
    }
    if (r.status === 400) throw new HttpException(r.data as object, 400);
    if (!r.ok || !r.accountId) {
      this.logger.warn(`No se pudo leer la cuenta de Google en booking (status ${r.status}).`);
      throw new ServiceUnavailableException({
        code: 'SERVICIO_NO_DISPONIBLE',
        message: 'No pudimos abrir tu cuenta en este momento. Intenta de nuevo en unos segundos.',
      });
    }
    return r;
  }

  /**
   * POST /api/auth/google { credential, modo? } → { token, user }
   *
   * Se entra únicamente con Google. El navegador manda el ID token que le dio
   * «Iniciar sesión con Google» y aquí se verifica (firma, emisor, audiencia,
   * expiración y correo verificado). booking guarda la cuenta por el `sub` de
   * Google. Toda cuenta puede entrar en modo cliente. En modo negocio solo si
   * ya registró su negocio; si no, 409 NEGOCIO_NO_REGISTRADO y el navegador
   * muestra el registro. El modo lo decide el servidor con lo guardado.
   */
  @Post('google')
  @HttpCode(200)
  async google(@Body() body: { credential?: unknown; modo?: unknown }) {
    if (body?.modo !== undefined && body.modo !== 'cliente' && body.modo !== 'negocio') {
      throw new BadRequestException({ code: 'MODO_INVALIDO', message: 'El modo debe ser cliente o negocio.' });
    }
    const id = await this.identidad(body?.credential);
    const cuenta = await this.cuenta(id);
    if (body?.modo === 'negocio' && !cuenta.negocio) {
      throw new ConflictException({ code: 'NEGOCIO_NO_REGISTRADO', message: 'Registra tu negocio para entrar al panel.', name: cuenta.name });
    }
    return this.sesionDeCuenta(cuenta, body?.modo === 'negocio' ? 'negocio' : 'cliente', id.name);
  }

  /**
   * POST /api/auth/negocio/registro { credential, legalName, nit, phone, acceptTerms } → { token, user }
   *
   * Activa el modo negocio. Es una acción sensible, así que pide confirmar
   * con Google otra vez: el token debe tener menos de 10 minutos. booking
   * valida los datos (NIT con dígito de verificación, teléfono, términos) y
   * que el NIT no esté en otra cuenta. Responde ya en modo negocio.
   */
  @Post('negocio/registro')
  @HttpCode(200)
  async registrarNegocio(@Body() body: { credential?: unknown; legalName?: unknown; nit?: unknown; phone?: unknown; acceptTerms?: unknown }) {
    const id = await this.identidad(body?.credential, { maxEdadSeg: EDAD_MAXIMA_REGISTRO_SEG });
    const cuenta = await this.cuenta(id);
    const r = await registrarNegocio(cuenta.accountId!, {
      legalName: body?.legalName,
      nit: body?.nit,
      phone: body?.phone,
      acceptTerms: body?.acceptTerms,
    });
    if (!r.ok) {
      if (r.status >= 400 && r.status < 500) throw new HttpException(r.data as object, r.status);
      throw new ServiceUnavailableException({ code: 'SERVICIO_NO_DISPONIBLE', message: 'No pudimos registrar tu negocio. Intenta de nuevo.' });
    }
    this.logger.log(`Modo negocio activado para la cuenta ${cuenta.accountId}.`);
    return this.sesionDeCuenta({ ...cuenta, negocio: true }, 'negocio', id.name);
  }

  /**
   * POST /api/auth/modo { modo } → { token, user }
   *
   * Cambia entre modo cliente y modo negocio sin volver a pasar por Google.
   * A cliente puede pasar cualquiera; a negocio solo una cuenta que lo tenga
   * activado (lo pregunta a booking, no se fía del token anterior).
   */
  @UseGuards(JwtAuthGuard)
  @Post('modo')
  @HttpCode(200)
  async cambiarModo(@Req() req: AuthedRequest, @Body('modo') modo: unknown) {
    if (modo !== 'cliente' && modo !== 'negocio') {
      throw new BadRequestException({ code: 'MODO_INVALIDO', message: 'El modo debe ser cliente o negocio.' });
    }
    const accountId = SUB_GOOGLE.exec(req.user.sub)?.[1];
    if (!accountId) throw new ForbiddenException({ code: 'SIN_CUENTA_GOOGLE', message: 'Esta sesión no puede cambiar de modo.' });
    const cuenta = await cuentaPorId(accountId);
    if (!cuenta.ok) {
      if (cuenta.status === 404) throw new ForbiddenException({ code: 'SIN_CUENTA_GOOGLE', message: 'Esta sesión no puede cambiar de modo.' });
      throw new ServiceUnavailableException({ code: 'SERVICIO_NO_DISPONIBLE', message: 'No pudimos cambiar de modo. Intenta de nuevo.' });
    }
    if (modo === 'negocio' && !cuenta.negocio) {
      throw new ForbiddenException({ code: 'NEGOCIO_NO_REGISTRADO', message: 'Primero registra tu negocio.' });
    }
    return this.sesionDeCuenta(cuenta, modo, req.user.name);
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
