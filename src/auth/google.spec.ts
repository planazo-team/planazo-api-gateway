import { googleClientIds, verificarGoogle } from './google';
import { OAuth2Client } from 'google-auth-library';

jest.mock('google-auth-library');

describe('google.ts', () => {
  const origEnv = process.env.GOOGLE_CLIENT_ID;

  afterEach(() => {
    process.env.GOOGLE_CLIENT_ID = origEnv;
    jest.clearAllMocks();
  });

  describe('googleClientIds', () => {
    it('debe parsear client IDs separados por coma', () => {
      process.env.GOOGLE_CLIENT_ID = 'client-1, client-2 , client-3';
      expect(googleClientIds()).toEqual(['client-1', 'client-2', 'client-3']);
    });

    it('debe retornar lista vacía si la variable no existe', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      expect(googleClientIds()).toEqual([]);
    });
  });

  describe('verificarGoogle', () => {
    it('debe retornar SIN_CONFIGURAR si no hay GOOGLE_CLIENT_ID', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const res = await verificarGoogle('some-token');
      expect(res).toEqual({ ok: false, code: 'SIN_CONFIGURAR' });
    });

    it('debe verificar y retornar la identidad si el token es válido', async () => {
      process.env.GOOGLE_CLIENT_ID = 'client-123';
      const mockPayload = {
        sub: 'google-sub-1',
        email: 'test@example.com',
        email_verified: true,
        name: 'Carlos Gomez',
        iat: Math.floor(Date.now() / 1000) - 10,
      };

      (OAuth2Client.prototype.verifyIdToken as jest.Mock).mockResolvedValueOnce({
        getPayload: () => mockPayload,
      });

      const res = await verificarGoogle('valid-token');
      expect(res).toEqual({
        ok: true,
        id: {
          sub: 'google-sub-1',
          email: 'test@example.com',
          name: 'Carlos Gomez',
        },
      });
    });

    it('debe rechazar con CREDENCIAL_INVALIDA si falla la verificación', async () => {
      process.env.GOOGLE_CLIENT_ID = 'client-123';
      (OAuth2Client.prototype.verifyIdToken as jest.Mock).mockRejectedValueOnce(new Error('Invalid signature'));

      const res = await verificarGoogle('bad-token');
      expect(res).toEqual({ ok: false, code: 'CREDENCIAL_INVALIDA' });
    });

    it('debe rechazar con CREDENCIAL_INVALIDA si payload no tiene sub o email', async () => {
      process.env.GOOGLE_CLIENT_ID = 'client-123';
      (OAuth2Client.prototype.verifyIdToken as jest.Mock).mockResolvedValueOnce({
        getPayload: () => ({ sub: '', email: '' }),
      });

      const res = await verificarGoogle('token-incomplete');
      expect(res).toEqual({ ok: false, code: 'CREDENCIAL_INVALIDA' });
    });

    it('debe rechazar con CORREO_NO_VERIFICADO si email_verified no es true', async () => {
      process.env.GOOGLE_CLIENT_ID = 'client-123';
      (OAuth2Client.prototype.verifyIdToken as jest.Mock).mockResolvedValueOnce({
        getPayload: () => ({
          sub: '123',
          email: 'unverified@test.com',
          email_verified: false,
        }),
      });

      const res = await verificarGoogle('unverified-token');
      expect(res).toEqual({ ok: false, code: 'CORREO_NO_VERIFICADO' });
    });

    it('debe rechazar con CREDENCIAL_VIEJA si supera maxEdadSeg', async () => {
      process.env.GOOGLE_CLIENT_ID = 'client-123';
      (OAuth2Client.prototype.verifyIdToken as jest.Mock).mockResolvedValueOnce({
        getPayload: () => ({
          sub: '123',
          email: 'old@test.com',
          email_verified: true,
          iat: Math.floor(Date.now() / 1000) - 1000,
        }),
      });

      const res = await verificarGoogle('old-token', { maxEdadSeg: 300 });
      expect(res).toEqual({ ok: false, code: 'CREDENCIAL_VIEJA' });
    });

    it('debe verificar credenciales emitidas por Firebase Auth (Google o correo)', async () => {
      process.env.GOOGLE_CLIENT_ID = 'client-123';
      (OAuth2Client.prototype.verifyIdToken as jest.Mock)
        .mockRejectedValueOnce(new Error('Wrong audience'))
        .mockResolvedValueOnce({
          getPayload: () => ({
            sub: 'fb-uid-1',
            email: 'cami@test.com',
            email_verified: false,
            iss: 'https://securetoken.google.com/planazo-auth',
            iat: Math.floor(Date.now() / 1000) - 5,
          }),
        });

      const meta = Buffer.from(JSON.stringify({ sub: 'fb-uid-1', name: 'Camila', email: 'cami@test.com' })).toString('base64');
      const wrapped = `eyJhbGciOiJmaXJlYmFzZSJ9.${meta}.header.payload.sig`;
      const res = await verificarGoogle(wrapped);
      expect(res).toEqual({
        ok: true,
        id: {
          sub: 'fb-uid-1',
          email: 'cami@test.com',
          name: 'Camila',
        },
      });
    });
  });
});
