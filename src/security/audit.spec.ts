import { AuditLogService } from './audit';
import type { Request, Response } from 'express';
import { EventEmitter } from 'events';

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(() => {
    service = new AuditLogService();
  });

  it('debe mapear correctamente las rutas sensibles', () => {
    expect(service.mapearAccionSensible('POST', '/api/auth/google')).toBe('INICIO_SESION');
    expect(service.mapearAccionSensible('POST', '/api/auth/demo')).toBe('INICIO_SESION');
    expect(service.mapearAccionSensible('POST', '/api/auth/negocio/registro')).toBe('REGISTRO_NEGOCIO');
    expect(service.mapearAccionSensible('POST', '/api/auth/modo')).toBe('CAMBIO_MODO');
    expect(service.mapearAccionSensible('POST', '/api/auth/negocio')).toBe('CREAR_LUGAR');
    expect(service.mapearAccionSensible('POST', '/api/places')).toBe('CREAR_LUGAR');
    expect(service.mapearAccionSensible('POST', '/api/promos')).toBe('CREAR_PROMO');
    expect(service.mapearAccionSensible('PATCH', '/api/promos/p1')).toBe('EDITAR_PROMO');
    expect(service.mapearAccionSensible('PATCH', '/api/places/pl1/slots/s1')).toBe('CAMBIAR_CAPACIDAD');
    expect(service.mapearAccionSensible('POST', '/api/promos/p1/reclamar')).toBe('RECLAMAR_CUPON');
    expect(service.mapearAccionSensible('POST', '/api/reservations')).toBe('CREAR_RESERVA');
    expect(service.mapearAccionSensible('DELETE', '/api/reservations/res-1')).toBe('CANCELAR_RESERVA');
    expect(service.mapearAccionSensible('GET', '/api/places')).toBeNull();
  });

  it('debe registrar y retornar eventos inmutables en la bitácora', () => {
    const record = service.registrar({
      userId: 'u1',
      action: 'CREAR_PROMO',
      ip: '127.0.0.1',
      correlationId: 'test-corr-id',
      details: { promoId: 'promo-123' },
    });

    expect(record.id).toBeDefined();
    expect(record.at).toBeGreaterThan(0);
    expect(record.action).toBe('CREAR_PROMO');
    expect(Object.isFrozen(record)).toBe(true);

    const logs = service.listar();
    expect(logs.length).toBe(1);
    expect(logs[0].userId).toBe('u1');
  });

  it('el middleware debe registrar eventos al completar con éxito una ruta sensible', () => {
    const mw = service.middleware();
    const req = {
      method: 'POST',
      originalUrl: '/api/auth/google',
      headers: {
        'x-user-id': 'usr-google-1',
        'x-correlation-id': 'corr-abc',
      },
      ip: '192.168.1.100',
    } as unknown as Request;

    const resEmitter = new EventEmitter() as any;
    resEmitter.statusCode = 200;
    const next = jest.fn();

    mw(req, resEmitter as Response, next);
    expect(next).toHaveBeenCalled();

    resEmitter.emit('finish');

    const logs = service.listar();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('INICIO_SESION');
    expect(logs[0].userId).toBe('usr-google-1');
    expect(logs[0].correlationId).toBe('corr-abc');
  });

  it('el middleware debe ignorar peticiones con error de cliente o servidor', () => {
    const mw = service.middleware();
    const req = {
      method: 'POST',
      originalUrl: '/api/auth/google',
      headers: {},
      ip: '127.0.0.1',
    } as unknown as Request;

    const resEmitter = new EventEmitter() as any;
    resEmitter.statusCode = 401;
    const next = jest.fn();

    mw(req, resEmitter as Response, next);
    resEmitter.emit('finish');

    expect(service.listar().length).toBe(0);
  });
});
