import { OAuth2Client } from 'google-auth-library';

/**
 * Verificación del ID token que entrega «Iniciar sesión con Google» o
 * Firebase Authentication (`planazo-auth`) en el navegador. La firma se
 * comprueba con las llaves públicas de Google/Firebase, junto con el emisor,
 * la audiencia y la expiración.
 */

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

export type GoogleFailure = 'SIN_CONFIGURAR' | 'CREDENCIAL_INVALIDA' | 'CORREO_NO_VERIFICADO' | 'CREDENCIAL_VIEJA';

const client = new OAuth2Client();
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || 'planazo-auth';
const FIREBASE_GOOGLE_CLIENT_ID = '601482275182-1nkmn6oive7v02d6rmtk9lkqcvacv9n9.apps.googleusercontent.com';
const PREFIJO_FIREBASE = 'eyJhbGciOiJmaXJlYmFzZSJ9.';

const firebaseClient = new OAuth2Client({
  endpoints: {
    oauth2FederatedSignonPemCertsUrl:
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    oauth2FederatedSignonJwkCertsUrl:
      'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  },
  issuers: [`https://securetoken.google.com/${FIREBASE_PROJECT}`],
});

/** Client IDs aceptados como audiencia, separados por coma en GOOGLE_CLIENT_ID. */
export function googleClientIds(): string[] {
  return (process.env.GOOGLE_CLIENT_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function desempaquetarCredencial(credential: string): { jwt: string; nombreExtra?: string } {
  if (!credential.startsWith(PREFIJO_FIREBASE)) return { jwt: credential };
  const partes = credential.split('.');
  const jwt = partes.slice(2).join('.');
  try {
    const meta = JSON.parse(Buffer.from(partes[1], 'base64').toString('utf8')) as { name?: string };
    return { jwt, nombreExtra: meta.name };
  } catch {
    return { jwt };
  }
}

/**
 * `maxEdadSeg`: para acciones sensibles (registrar un negocio) se exige que
 * Google/Firebase haya emitido el token hace poco, como cuando un banco pide
 * la clave otra vez antes de una transferencia.
 */
export async function verificarGoogle(
  credential: string,
  opciones: { maxEdadSeg?: number } = {},
): Promise<{ ok: true; id: GoogleIdentity } | { ok: false; code: GoogleFailure }> {
  const audience = googleClientIds();
  if (!audience.length) return { ok: false, code: 'SIN_CONFIGURAR' };
  const { jwt, nombreExtra } = desempaquetarCredencial(credential);
  if (!jwt) return { ok: false, code: 'CREDENCIAL_INVALIDA' };

  try {
    let p: { sub?: string; email?: string; email_verified?: boolean; name?: string; iat?: number; iss?: string } | undefined;
    try {
      p = (await client.verifyIdToken({ idToken: jwt, audience: [...audience, FIREBASE_GOOGLE_CLIENT_ID] })).getPayload();
    } catch (err) {
      if (!jwt.includes('.')) throw err;
      p = (await firebaseClient.verifyIdToken({ idToken: jwt, audience: FIREBASE_PROJECT })).getPayload();
    }
    if (!p?.sub || !p.email) return { ok: false, code: 'CREDENCIAL_INVALIDA' };
    const esDeFirebase = typeof p.iss === 'string' && p.iss.startsWith('https://securetoken.google.com/');
    if (!esDeFirebase && p.email_verified !== true) return { ok: false, code: 'CORREO_NO_VERIFICADO' };
    if (opciones.maxEdadSeg && (!p.iat || Date.now() / 1000 - p.iat > opciones.maxEdadSeg)) return { ok: false, code: 'CREDENCIAL_VIEJA' };
    const nombre = p.name || nombreExtra || p.email.split('@')[0] || '';
    return { ok: true, id: { sub: p.sub, email: p.email, name: nombre } };
  } catch {
    return { ok: false, code: 'CREDENCIAL_INVALIDA' };
  }
}
