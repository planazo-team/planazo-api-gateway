import { OAuth2Client } from 'google-auth-library';

/**
 * Verificación del ID token que entrega «Iniciar sesión con Google» en el
 * navegador. La firma se comprueba con las llaves públicas de Google (la
 * librería las descarga y las guarda en caché), junto con el emisor
 * (accounts.google.com), la audiencia (nuestro client ID) y la expiración.
 * Planazo no guarda contraseñas: la identidad la garantiza Google.
 */

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

export type GoogleFailure = 'SIN_CONFIGURAR' | 'CREDENCIAL_INVALIDA' | 'CORREO_NO_VERIFICADO' | 'CREDENCIAL_VIEJA';

const client = new OAuth2Client();

/** Client IDs aceptados como audiencia, separados por coma en GOOGLE_CLIENT_ID. */
export function googleClientIds(): string[] {
  return (process.env.GOOGLE_CLIENT_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `maxEdadSeg`: para acciones sensibles (registrar un negocio) se exige que
 * Google haya emitido el token hace poco, como cuando un banco pide la clave
 * otra vez antes de una transferencia.
 */
export async function verificarGoogle(
  credential: string,
  opciones: { maxEdadSeg?: number } = {},
): Promise<{ ok: true; id: GoogleIdentity } | { ok: false; code: GoogleFailure }> {
  const audience = googleClientIds();
  if (!audience.length) return { ok: false, code: 'SIN_CONFIGURAR' };
  try {
    const p = (await client.verifyIdToken({ idToken: credential, audience })).getPayload();
    if (!p?.sub || !p.email) return { ok: false, code: 'CREDENCIAL_INVALIDA' };
    if (p.email_verified !== true) return { ok: false, code: 'CORREO_NO_VERIFICADO' };
    if (opciones.maxEdadSeg && (!p.iat || Date.now() / 1000 - p.iat > opciones.maxEdadSeg)) return { ok: false, code: 'CREDENCIAL_VIEJA' };
    return { ok: true, id: { sub: p.sub, email: p.email, name: p.name ?? '' } };
  } catch {
    return { ok: false, code: 'CREDENCIAL_INVALIDA' };
  }
}
