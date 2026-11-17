import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { auditLogService } from '../security/audit';
import { verificarAccesoPorRol } from './role-auth';

describe('verificarAccesoPorRol (RBAC y trazabilidad por establecimiento)', () => {
  const reqComo = (
    role: string,
    method: string,
    originalUrl: string,
    placeId?: string,
    body?: Record<string, unknown>,
  ): Request =>
    ({
      method,
      originalUrl,
      body,
      ip: '127.0.0.1',
      headers: { 'x-correlation-id': 'corr-rbac' },
      user: { sub: role === 'negocio' ? 'b1' : 'u1', name: 'Test', role, ...(placeId ? { placeId } : {}) },
    }) as unknown as Request;

  it('permite a cliente reservar, reclamar cupones y jugar el minijuego', () => {
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'GET', '/api/places'), 'places')).not.toThrow();
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'POST', '/api/reservations'), 'reservations')).not.toThrow();
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'GET', '/api/reservations/mine'), 'reservations')).not.toThrow();
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'POST', '/api/promos/pr1/claim'), 'promos')).not.toThrow();
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'GET', '/api/promos/mine'), 'promos')).not.toThrow();
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'GET', '/api/salas'), 'game')).not.toThrow();
  });

  it('bloquea a cliente cuando intenta usar operaciones de negocio y deja traza en AuditLog', () => {
    const antes = auditLogService.listar().length;
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'POST', '/api/promos'), 'promos')).toThrow(ForbiddenException);
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'POST', '/api/events'), 'events')).toThrow(ForbiddenException);
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'PATCH', '/api/places/p1/slots/s1'), 'places')).toThrow(
      ForbiddenException,
    );
    expect(() => verificarAccesoPorRol(reqComo('cliente', 'GET', '/api/places/p1/reservations'), 'places')).toThrow(
      ForbiddenException,
    );
    const despues = auditLogService.listar();
    expect(despues.length).toBeGreaterThan(antes);
    expect(despues.at(-1)).toMatchObject({
      action: 'ACCESO_DENEGADO_ROL',
      userId: 'u1',
      role: 'cliente',
    });
  });

  it('permite a negocio gestionar su propio placeId pero bloquea si intenta tocar otro establecimiento o actuar como cliente', () => {
    expect(() =>
      verificarAccesoPorRol(reqComo('negocio', 'PATCH', '/api/places/p1/slots/s1', 'p1'), 'places'),
    ).not.toThrow();
    expect(() =>
      verificarAccesoPorRol(reqComo('negocio', 'GET', '/api/places/p1/reservations', 'p1'), 'places'),
    ).not.toThrow();
    expect(() =>
      verificarAccesoPorRol(reqComo('negocio', 'POST', '/api/events', 'p1', { placeId: 'p1' }), 'events'),
    ).not.toThrow();
    expect(() =>
      verificarAccesoPorRol(reqComo('negocio', 'POST', '/api/promos', 'p1', { placeId: 'p1' }), 'promos'),
    ).not.toThrow();

    // Otro establecimiento (p2 != p1)
    expect(() =>
      verificarAccesoPorRol(reqComo('negocio', 'PATCH', '/api/places/p2/slots/s1', 'p1'), 'places'),
    ).toThrow(ForbiddenException);
    expect(() =>
      verificarAccesoPorRol(reqComo('negocio', 'POST', '/api/events', 'p1', { placeId: 'p2' }), 'events'),
    ).toThrow(ForbiddenException);
    expect(() =>
      verificarAccesoPorRol(reqComo('negocio', 'POST', '/api/promos', 'p1', { placeId: 'p2' }), 'promos'),
    ).toThrow(ForbiddenException);

    // Acciones exclusivas de cliente
    expect(() => verificarAccesoPorRol(reqComo('negocio', 'POST', '/api/reservations', 'p1'), 'reservations')).toThrow(
      ForbiddenException,
    );
    expect(() =>
      verificarAccesoPorRol(reqComo('negocio', 'POST', '/api/promos/pr1/claim', 'p1'), 'promos'),
    ).toThrow(ForbiddenException);
    expect(() => verificarAccesoPorRol(reqComo('negocio', 'GET', '/api/salas', 'p1'), 'game')).toThrow(
      ForbiddenException,
    );
    expect(() => verificarAccesoPorRol(reqComo('negocio', 'GET', '/api/leaderboard', 'p1'), 'game')).not.toThrow();
  });

  it('rechaza cualquier rol desconocido', () => {
    expect(() => verificarAccesoPorRol(reqComo('otro' as any, 'GET', '/api/places'), 'places')).toThrow(
      ForbiddenException,
    );
  });
});
