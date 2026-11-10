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
  role?: 'cliente' | 'negocio' | null;
  data?: unknown;
}

/**
 * Busca o crea la cuenta de esta identidad de Google en booking (que la
 * guarda en `booking.google_accounts`). `role` solo se guarda la primera vez;
 * `role: null` en la respuesta es que la persona todavía no ha elegido.
 * `status: 0` es que booking no respondió.
 */
export async function googleAccount(
  id: { googleSub: string; email: string; name: string },
  role?: 'cliente' | 'negocio',
): Promise<CuentaGoogle> {
  try {
    const { data, status } = await axios.post(
      `${bookingUrl()}/accounts/google`,
      { ...id, ...(role ? { role } : {}) },
      {
        headers: { 'content-type': 'application/json', 'x-gateway-key': process.env.GATEWAY_KEY ?? '' },
        timeout: 5_000,
        validateStatus: () => true,
      },
    );
    if (status === 200 && data?.accountId) {
      return { ok: true, status, accountId: String(data.accountId), name: String(data.name ?? id.name), role: data.role ?? null };
    }
    return { ok: false, status, data };
  } catch {
    return { ok: false, status: 0 };
  }
}
