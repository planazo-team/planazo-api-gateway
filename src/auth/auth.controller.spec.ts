import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import * as bookingClient from './booking.client';
import * as googleAuth from './google';

jest.mock('./booking.client');
jest.mock('./google');

describe('AuthController', () => {
  let controller: AuthController;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService = {
      sign: jest.fn().mockReturnValue('mocked.jwt.token'),
    } as unknown as jest.Mocked<JwtService>;
    controller = new AuthController(jwtService);
  });

  describe('demo', () => {
    const prevKey = process.env.DEMO_LOGIN_KEY;

    afterEach(() => {
      process.env.DEMO_LOGIN_KEY = prevKey;
    });

    it('debe responder 404 si DEMO_LOGIN_KEY no está configurada', () => {
      delete process.env.DEMO_LOGIN_KEY;
      expect(() => controller.demo({ userId: 'u1' }, 'clave')).toThrow(NotFoundException);
    });

    it('debe responder 401 si la llave demo no coincide', () => {
      process.env.DEMO_LOGIN_KEY = 'secret-demo-key';
      expect(() => controller.demo({ userId: 'u1' }, 'clave-invalida')).toThrow(UnauthorizedException);
    });

    it('debe firmar token para usuario semilla con llave correcta', () => {
      process.env.DEMO_LOGIN_KEY = 'secret-demo-key';
      const res = controller.demo({ userId: 'u1' }, 'secret-demo-key');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'u1',
          role: 'cliente',
        }),
      );
      expect(res.token).toBe('mocked.jwt.token');
      expect(res.user.id).toBe('u1');
    });

    it('debe permitir usuario de pruebas qa-...', () => {
      process.env.DEMO_LOGIN_KEY = 'secret-demo-key';
      const res = controller.demo({ userId: 'qa-tester-1', name: 'Tester', role: 'negocio' }, 'secret-demo-key');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'n-qa-tester-1',
          role: 'negocio',
        }),
      );
      expect(res.token).toBe('mocked.jwt.token');
    });

    it('debe rechazar userId inválido', () => {
      process.env.DEMO_LOGIN_KEY = 'secret-demo-key';
      expect(() => controller.demo({ userId: 'invalido' }, 'secret-demo-key')).toThrow(BadRequestException);
    });
  });

  describe('google', () => {
    it('debe rechazar modo inválido', async () => {
      await expect(controller.google({ credential: 'tok', modo: 'otro' })).rejects.toThrow(BadRequestException);
    });

    it('debe rechazar credencial vacía o mayor a 4096 caracteres', async () => {
      await expect(controller.google({ credential: '' })).rejects.toThrow(BadRequestException);
      await expect(controller.google({ credential: 'a'.repeat(4097) })).rejects.toThrow(BadRequestException);
    });

    it('debe rechazar si verificarGoogle retorna error', async () => {
      (googleAuth.verificarGoogle as jest.Mock).mockResolvedValueOnce({ ok: false, code: 'CREDENCIAL_INVALIDA' });
      await expect(controller.google({ credential: 'bad' })).rejects.toThrow(UnauthorizedException);

      (googleAuth.verificarGoogle as jest.Mock).mockResolvedValueOnce({ ok: false, code: 'SIN_CONFIGURAR' });
      await expect(controller.google({ credential: 'bad' })).rejects.toThrow(ServiceUnavailableException);
    });

    it('debe rechazar modo negocio si la cuenta no tiene negocio registrado', async () => {
      (googleAuth.verificarGoogle as jest.Mock).mockResolvedValueOnce({
        ok: true,
        id: { sub: 'sub-1', email: 'test@example.com', name: 'User 1' },
      });
      (bookingClient.googleAccount as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        accountId: 'g123456789012',
        name: 'User 1',
        negocio: false,
      });

      await expect(controller.google({ credential: 'good', modo: 'negocio' })).rejects.toThrow(ConflictException);
    });

    it('debe iniciar sesión en modo cliente exitosamente', async () => {
      (googleAuth.verificarGoogle as jest.Mock).mockResolvedValueOnce({
        ok: true,
        id: { sub: 'sub-1', email: 'test@example.com', name: 'User 1' },
      });
      (bookingClient.googleAccount as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        accountId: 'g123456789012',
        name: 'User 1',
        negocio: false,
      });

      const res = await controller.google({ credential: 'good', modo: 'cliente' });
      expect(res.token).toBe('mocked.jwt.token');
      expect(res.user.id).toBe('c-g123456789012');
      expect(res.user.role).toBe('cliente');
    });

    it('debe iniciar sesión en modo negocio con su placeId si ya lo tiene', async () => {
      (googleAuth.verificarGoogle as jest.Mock).mockResolvedValueOnce({
        ok: true,
        id: { sub: 'sub-negocio', email: 'biz@example.com', name: 'Bar Central' },
      });
      (bookingClient.googleAccount as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        accountId: 'g999999999999',
        name: 'Bar Central',
        negocio: true,
      });
      (bookingClient.ownedPlaceId as jest.Mock).mockResolvedValueOnce('place-bar-1');

      const res = await controller.google({ credential: 'good', modo: 'negocio' });
      expect(res.token).toBe('mocked.jwt.token');
      expect(res.user.id).toBe('n-g999999999999');
      expect(res.user.role).toBe('negocio');
      expect(res.user.placeId).toBe('place-bar-1');
    });
  });

  describe('registrarNegocio', () => {
    it('debe registrar negocio y retornar sesión negocio', async () => {
      (googleAuth.verificarGoogle as jest.Mock).mockResolvedValueOnce({
        ok: true,
        id: { sub: 'sub-negocio', email: 'biz@example.com', name: 'Bar Central' },
      });
      (bookingClient.googleAccount as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        accountId: 'g999999999999',
        name: 'Bar Central',
        negocio: false,
      });
      (bookingClient.registrarNegocio as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
      (bookingClient.ownedPlaceId as jest.Mock).mockResolvedValueOnce(null);

      const res = await controller.registrarNegocio({
        credential: 'valid',
        legalName: 'Mi Negocio SAS',
        nit: '900123456-1',
        phone: '3001234567',
        acceptTerms: true,
      });

      expect(res.token).toBe('mocked.jwt.token');
      expect(res.user.role).toBe('negocio');
      expect(res.user.negocio).toBe(true);
    });

    it('debe propagar error de validación 400 de booking', async () => {
      (googleAuth.verificarGoogle as jest.Mock).mockResolvedValueOnce({
        ok: true,
        id: { sub: 'sub-negocio', email: 'biz@example.com', name: 'Bar Central' },
      });
      (bookingClient.googleAccount as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        accountId: 'g999999999999',
        name: 'Bar Central',
      });
      (bookingClient.registrarNegocio as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        data: { code: 'NIT_INVALIDO', message: 'El NIT no es válido.' },
      });

      await expect(
        controller.registrarNegocio({
          credential: 'valid',
          nit: 'invalido',
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('cambiarModo', () => {
    it('debe rechazar modo inválido', async () => {
      const req = { user: { sub: 'c-gABCDEFGH2345' } } as any;
      await expect(controller.cambiarModo(req, 'invalido')).rejects.toThrow(BadRequestException);
    });

    it('debe rechazar si la sesión no es de Google (ej. usuario demo u1)', async () => {
      const req = { user: { sub: 'u1' } } as any;
      await expect(controller.cambiarModo(req, 'cliente')).rejects.toThrow(ForbiddenException);
    });

    it('debe rechazar cambiar a negocio si la cuenta no tiene negocio registrado', async () => {
      const req = { user: { sub: 'c-gABCDEFGH2345', name: 'Carlos' } } as any;
      (bookingClient.cuentaPorId as jest.Mock).mockResolvedValueOnce({
        ok: true,
        accountId: 'gABCDEFGH2345',
        negocio: false,
      });

      await expect(controller.cambiarModo(req, 'negocio')).rejects.toThrow(ForbiddenException);
    });

    it('debe cambiar de modo exitosamente a negocio', async () => {
      const req = { user: { sub: 'c-gABCDEFGH2345', name: 'Carlos' } } as any;
      (bookingClient.cuentaPorId as jest.Mock).mockResolvedValueOnce({
        ok: true,
        accountId: 'gABCDEFGH2345',
        name: 'Carlos',
        negocio: true,
      });
      (bookingClient.ownedPlaceId as jest.Mock).mockResolvedValueOnce('place-carlos');

      const res = await controller.cambiarModo(req, 'negocio');
      expect(res.user.role).toBe('negocio');
      expect(res.user.placeId).toBe('place-carlos');
    });
  });

  describe('me', () => {
    it('debe retornar datos de la sesión autenticada', () => {
      const req = {
        user: {
          sub: 'u1',
          name: 'Carlos',
          role: 'cliente' as const,
          exp: 1700000000,
        },
      } as any;

      const res = controller.me(req);
      expect(res).toEqual({
        userId: 'u1',
        name: 'Carlos',
        role: 'cliente',
        placeId: null,
        expiresAt: 1700000000000,
      });
    });
  });

  describe('crearNegocio', () => {
    it('debe rechazar si el usuario no tiene rol negocio', async () => {
      const req = { user: { sub: 'u1', role: 'cliente' } } as any;
      await expect(controller.crearNegocio(req, {})).rejects.toThrow(ForbiddenException);
    });

    it('debe crear lugar y firmar token con placeId para rol negocio', async () => {
      const req = { user: { sub: 'n-1', role: 'negocio', name: 'Mi Negocio' } } as any;
      (bookingClient.createPlace as jest.Mock).mockResolvedValueOnce({
        status: 201,
        data: { id: 'p-new', name: 'Mi Negocio' },
      });

      const res = await controller.crearNegocio(req, { name: 'Mi Negocio' });
      expect(bookingClient.createPlace).toHaveBeenCalledWith(req.user, { name: 'Mi Negocio' });
      expect(res.place).toEqual({ id: 'p-new', name: 'Mi Negocio' });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          placeId: 'p-new',
        }),
      );
    });
  });
});
