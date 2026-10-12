import axios from 'axios';

/**
 * Llamadas del gateway a booking en nombre de un usuario. Las usa el login
 * (¿este negocio ya tiene lugar?) y el alta de negocios (crear el lugar y
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
