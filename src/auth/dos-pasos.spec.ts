import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import * as bookingClient from './booking.client';
import * as googleAuth from './google';

jest.mock('./booking.client');
jest.mock('./google');

const cuentaNegocio = (dosPasos: boolean) => ({ ok: true, status: 200, accountId: 'g999999999999', name: 'Bar Central', negocio: true, dosPasos });
const statusDe = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return { status: (e as HttpException).getStatus(), code: ((e as HttpException).getResponse() as { code?: string }).code };
  }
};

describe('verificación en dos pasos (gateway)', () => {
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController({ sign: jest.fn().mockReturnValue('jwt') } as unknown as JwtService);
    (googleAuth.verificarGoogle as jest.Mock).mockResolvedValue({ ok: true, id: { sub: 's', email: 'b@x.co', name: 'Bar Central' } });
    (bookingClient.ownedPlaceId as jest.Mock).mockResolvedValue('place-1');
  });

  it('sin 2FA activo, el modo negocio entra solo con Google (como antes)', async () => {
    (bookingClient.googleAccount as jest.Mock).mockResolvedValueOnce(cuentaNegocio(false));
    const r = await controller.google({ credential: 'ok', modo: 'negocio' });
    expect(r.user.role).toBe('negocio');
    expect(bookingClient.dosPasos).not.toHaveBeenCalled();
  });

  it('con 2FA activo y sin código responde 401 2FA_REQUERIDO, sin tocar booking', async () => {
    (bookingClient.googleAccount as jest.Mock).mockResolvedValueOnce(cuentaNegocio(true));
    expect(await statusDe(controller.google({ credential: 'ok', modo: 'negocio' }))).toEqual({ status: 401, code: '2FA_REQUERIDO' });
    expect(bookingClient.dosPasos).not.toHaveBeenCalled();
  });

  it('con 2FA activo y código bueno entra en modo negocio', async () => {
    (bookingClient.googleAccount as jest.Mock).mockResolvedValueOnce(cuentaNegocio(true));
    (bookingClient.dosPasos as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, data: { ok: true } });
    const r = await controller.google({ credential: 'ok', modo: 'negocio', codigo: '123456' });
    expect(r.user.role).toBe('negocio');
    expect(bookingClient.dosPasos).toHaveBeenCalledWith('g999999999999', 'verificar', '123456');
  });

  it('código equivocado o bloqueado: reenvía el 401/429 de booking', async () => {
    (bookingClient.googleAccount as jest.Mock).mockResolvedValue(cuentaNegocio(true));
    (bookingClient.dosPasos as jest.Mock).mockResolvedValueOnce({ ok: false, status: 401, data: { code: '2FA_INVALIDO', message: 'x' } });
    expect(await statusDe(controller.google({ credential: 'ok', modo: 'negocio', codigo: '000000' }))).toEqual({ status: 401, code: '2FA_INVALIDO' });
    (bookingClient.dosPasos as jest.Mock).mockResolvedValueOnce({ ok: false, status: 429, data: { code: '2FA_BLOQUEADO', message: 'x' } });
    expect(await statusDe(controller.google({ credential: 'ok', modo: 'negocio', codigo: '000000' }))).toEqual({ status: 429, code: '2FA_BLOQUEADO' });
    (bookingClient.dosPasos as jest.Mock).mockResolvedValueOnce({ ok: false, status: 0 });
    expect(await statusDe(controller.google({ credential: 'ok', modo: 'negocio', codigo: '000000' }))).toMatchObject({ status: 503 });
  });

  it('el modo cliente nunca pide el código', async () => {
    (bookingClient.googleAccount as jest.Mock).mockResolvedValueOnce(cuentaNegocio(true));
    const r = await controller.google({ credential: 'ok', modo: 'cliente' });
    expect(r.user.role).toBe('cliente');
  });

  it('cambiar a modo negocio también exige el código si está activo', async () => {
    const req = { user: { sub: 'c-g999999999999', name: 'Bar Central' } } as never;
    (bookingClient.cuentaPorId as jest.Mock).mockResolvedValue(cuentaNegocio(true));
    expect(await statusDe(controller.cambiarModo(req, 'negocio'))).toEqual({ status: 401, code: '2FA_REQUERIDO' });
    (bookingClient.dosPasos as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, data: { ok: true } });
    expect((await controller.cambiarModo(req, 'negocio', '654321')).user.role).toBe('negocio');
    expect((await controller.cambiarModo(req, 'cliente')).user.role).toBe('cliente');
  });

  it('activar: solo en modo negocio, y reenvía QR y confirmación de booking', async () => {
    const cliente = { user: { sub: 'c-g999999999999', role: 'cliente' } } as never;
    await expect(controller.iniciarDosPasos(cliente)).rejects.toThrow(ForbiddenException);
    await expect(controller.confirmarDosPasos(cliente, '1')).rejects.toThrow(ForbiddenException);

    const negocio = { user: { sub: 'n-g999999999999', role: 'negocio' } } as never;
    (bookingClient.dosPasos as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, data: { otpauthUri: 'otpauth://totp/x', secreto: 'ABC' } });
    expect(await controller.iniciarDosPasos(negocio)).toEqual({ otpauthUri: 'otpauth://totp/x', secreto: 'ABC' });
    (bookingClient.dosPasos as jest.Mock).mockResolvedValueOnce({ ok: false, status: 401, data: { code: '2FA_INVALIDO' } });
    await expect(controller.confirmarDosPasos(negocio, '000000')).rejects.toThrow(HttpException);
    (bookingClient.dosPasos as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, data: { activo: true } });
    expect(await controller.confirmarDosPasos(negocio, '123456')).toEqual({ activo: true });
    (bookingClient.dosPasos as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, data: { activo: true } });
    expect(await controller.estadoDosPasos(negocio)).toEqual({ activo: true });
  });

  it('una sesión que no es de Google no puede consultar ni activar', async () => {
    const demo = { user: { sub: 'u1', role: 'negocio' } } as never;
    await expect(controller.estadoDosPasos(demo)).rejects.toThrow(ForbiddenException);
    await expect(controller.iniciarDosPasos(demo)).rejects.toThrow(ForbiddenException);
    expect(UnauthorizedException).toBeDefined();
  });
});
