import axios from 'axios';

/**
 * Llamadas del gateway a booking. Las usa el login con Google (la cuenta y su
 * rol; ¿este negocio ya tiene lugar?) y el alta de negocios (crear el lugar y
 * firmar un token nuevo que lo incluya).
 */

const bookingUrl = () => (process.env.BOOKING_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export interface Who {
  sub: string;
  name: string;
  role: 'cliente' | 'negocio';
  placeId?: string;
}

function headers(who: Who) {
  return {
    'content-type': 'application/json',
    'x-user-id': who.sub,
    'x-user-name': encodeURIComponent(who.name),
    'x-user-role': who.role,
    'x-user-place-id': who.placeId ?? '',
    'x-gateway-key': process.env.GATEWAY_KEY ?? '',
  };
}

/** El lugar que administra este usuario, o `null` si todavía no creó ninguno. */
export async function ownedPlaceId(who: Who): Promise<string | null> {
  try {
    const { data, status } = await axios.get(`${bookingUrl()}/places/owned`, {
      headers: headers(who),
      timeout: 5_000,
      validateStatus: () => true,
    });
    return status === 200 && data?.id ? String(data.id) : null;
  } catch {
    return null;
  }
}

/** Crea el lugar en booking. Devuelve la respuesta tal cual para reenviar errores. */
export async function createPlace(who: Who, body: unknown) {
  try {
    const { data, status } = await axios.post(`${bookingUrl()}/places`, body, {
      headers: headers(who),
      timeout: 10_000,
      validateStatus: () => true,
    });
    return { status, data };
  } catch {
    return {
      status: 502,
      data: { code: 'SERVICIO_NO_DISPONIBLE', message: 'No se pudo contactar el servicio de lugares.' },
    };
  }
}

export interface CuentaGoogle {
  ok: boolean;
  /** HTTP de booking; 0 si no respondió. */
  status: number;
  accountId?: string;
  name?: string;
  /** Si la cuenta ya activó el modo negocio. */
  negocio?: boolean;
  /** Si la cuenta tiene activa la verificación en dos pasos (se pide para entrar en modo negocio). */
  dosPasos?: boolean;
  data?: unknown;
}

const internos = () => ({ 'content-type': 'application/json', 'x-gateway-key': process.env.GATEWAY_KEY ?? '' });

async function pedir(method: 'get' | 'post', path: string, body?: unknown): Promise<CuentaGoogle> {
  try {
    const { data, status } = await axios.request({
      method,
      url: `${bookingUrl()}${path}`,
      data: body,
      headers: internos(),
      timeout: 5_000,
      validateStatus: () => true,
    });
    if (status === 200 && data?.accountId) {
      return {
        ok: true,
        status,
        accountId: String(data.accountId),
        name: data.name,
        negocio: data.negocio === true,
        dosPasos: data.dosPasos === true,
        data,
      };
    }
    return { ok: false, status, data };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Busca o crea la cuenta de esta identidad de Google en booking
 * (`booking.google_accounts`). `status: 0` es que booking no respondió.
 */
export function googleAccount(id: { googleSub: string; email: string; name: string }): Promise<CuentaGoogle> {
  return pedir('post', '/accounts/google', id);
}

/** La cuenta por su id (el que va en el token): ¿tiene modo negocio? */
export function cuentaPorId(accountId: string): Promise<CuentaGoogle> {
  return pedir('get', `/accounts/${encodeURIComponent(accountId)}`);
}

/** Activa el modo negocio. booking valida razón social, NIT, teléfono y términos. */
export function registrarNegocio(
  accountId: string,
  datos: { legalName: unknown; nit: unknown; phone: unknown; acceptTerms: unknown },
): Promise<CuentaGoogle> {
  return pedir('post', `/accounts/${encodeURIComponent(accountId)}/negocio`, datos);
}

export interface RespuestaBooking {
  ok: boolean;
  /** HTTP de booking; 0 si no respondió. */
  status: number;
  data?: unknown;
}

/**
 * Verificación en dos pasos (TOTP) en booking: `estado` (GET), `iniciar`
 * (secreto nuevo para el QR), `confirmar` (el primer código la activa) y
 * `verificar` (código para entrar en modo negocio).
 */
export async function dosPasos(
  accountId: string,
  accion: 'estado' | 'iniciar' | 'confirmar' | 'verificar',
  codigo?: unknown,
): Promise<RespuestaBooking> {
  const ruta = `/accounts/${encodeURIComponent(accountId)}/2fa${accion === 'estado' ? '' : `/${accion}`}`;
  try {
    const { data, status } = await axios.request({
      method: accion === 'estado' ? 'get' : 'post',
      url: `${bookingUrl()}${ruta}`,
      data: accion === 'confirmar' || accion === 'verificar' ? { codigo } : undefined,
      headers: internos(),
      timeout: 5_000,
      validateStatus: () => true,
    });
    return { ok: status >= 200 && status < 300, status, data };
  } catch {
    return { ok: false, status: 0 };
  }
}
