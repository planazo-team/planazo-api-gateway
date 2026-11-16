import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { accessLog, idDePeticion, rutaSegura } from './access-log';
import { idReplica, SERVIDO_POR } from './replica';

function resFalsa() {
  const headers: Record<string, string> = {};
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v),
    getHeader: (k: string) => headers[k.toLowerCase()],
  });
  return { res: res as unknown as Response & EventEmitter, headers };
}

describe('observabilidad: réplica y log de acceso', () => {
  it('idReplica usa RAILWAY_REPLICA_ID, luego HOSTNAME, y lo deja seguro y corto', () => {
    expect(idReplica({ RAILWAY_REPLICA_ID: 'a1b2c3d4-e5f6-7890' }, 'host')).toBe('a1b2c3d4');
    expect(idReplica({ HOSTNAME: 'contenedor_01' }, 'host')).toBe('contened');
    expect(idReplica({}, '')).toBe('local');
    expect(idReplica({ RAILWAY_REPLICA_ID: '<script>' }, '')).toBe('script');
  });

  it('acepta el x-request-id del cliente solo si es válido', () => {
    expect(idDePeticion('abc-123')).toBe('abc-123');
    expect(idDePeticion('mal id\ncon salto')).toMatch(/^[0-9a-f-]{36}$/);
    expect(idDePeticion(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('la ruta del log no lleva query string ni caracteres de control', () => {
    expect(rutaSegura('/api/promos?token=secreto')).toBe('/api/promos');
    expect(rutaSegura('/api/x\r\nFALSO')).toBe('/api/xFALSO');
  });

  it('marca la respuesta con x-served-by y escribe una línea JSON al terminar', () => {
    const lineas: string[] = [];
    const { res, headers } = resFalsa();
    const req = { method: 'GET', originalUrl: '/api/places?zone=zona-t', headers: {} } as unknown as Request;
    const next = jest.fn();
    accessLog((l) => lineas.push(l))(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(headers['x-served-by']).toBe(SERVIDO_POR);
    expect(req.headers['x-correlation-id']).toBe(req.headers['x-request-id']);

    res.setHeader('x-upstream-served-by', 'booking@r2');
    res.statusCode = 404;
    res.emit('finish');
    const linea = JSON.parse(lineas[0]);
    expect(linea).toMatchObject({
      svc: 'api-gateway',
      metodo: 'GET',
      ruta: '/api/places',
      status: 404,
      nivel: 'warn',
      upstream: 'booking@r2',
    });
    expect(typeof linea.ms).toBe('number');
  });

  it('una respuesta 5xx queda como error y una 2xx como info', () => {
    const lineas: string[] = [];
    for (const status of [503, 201]) {
      const { res } = resFalsa();
      accessLog((l) => lineas.push(l))({ method: 'POST', url: '/api/x', headers: {} } as unknown as Request, res, jest.fn());
      res.statusCode = status;
      res.emit('finish');
    }
    expect(lineas.map((l) => JSON.parse(l).nivel)).toEqual(['error', 'info']);
  });
});
