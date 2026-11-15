import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(() => {
    jwtService = {
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;
    guard = new JwtAuthGuard(jwtService);
  });

  function mockContext(headers: Record<string, string>): ExecutionContext {
    const req = { headers } as unknown as Request;
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  }

  it('debe lanzar UnauthorizedException SIN_TOKEN si falta cabecera Authorization', () => {
    const ctx = mockContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('debe lanzar UnauthorizedException TOKEN_INVALIDO si verify falla', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('Invalid');
    });
    const ctx = mockContext({ authorization: 'Bearer invalid-token' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('debe permitir acceso y guardar payload en req.user si el token es válido', () => {
    const payload = { sub: 'u1', role: 'cliente' };
    jwtService.verify.mockReturnValue(payload);
    const ctx = mockContext({ authorization: 'Bearer valid-token' });
    const can = guard.canActivate(ctx);
    expect(can).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toEqual(payload);
  });
});
