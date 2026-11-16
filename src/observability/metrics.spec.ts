import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';
import {
  consultasAgente,
  funcionalidadDe,
  medirHttp,
  registrarActividad,
  registro,
  rutaDe,
  servidorDeMetricas,
  sesionesEmitidas,
} from './metrics';

describe('métricas para Prometheus', () => {
  it('etiqueta la ruta con su plantilla, nunca con ids reales', () => {
    expect(rutaDe({ route: { path: '/places/:id' }, baseUrl: '/api' } as unknown as Request)).toBe('/api/places/:id');
    expect(rutaDe({ route: { path: '/promos/*splat' } } as unknown as Request)).toBe('/promos/*');
    expect(rutaDe({} as Request)).toBe('sin_ruta');
  });

  it('agrupa las peticiones por funcionalidad', () => {
    expect(funcionalidadDe('/api/places/p1?zone=zona-g')).toBe('places');
    expect(funcionalidadDe('/api/auth/google')).toBe('auth');
    expect(funcionalidadDe('/salud')).toBe('otra');
  });

  it('mide cada petición al terminar y cuenta la funcionalidad', async () => {
    const res = new EventEmitter() as unknown as Response;
    (res as unknown as { statusCode: number }).statusCode = 201;
    const next = jest.fn();
    medirHttp()({ method: 'POST', originalUrl: '/api/reservations', route: { path: '/api/reservations' } } as unknown as Request, res, next);
    expect(next).toHaveBeenCalled();
    (res as unknown as EventEmitter).emit('finish');
    const texto = await registro.metrics();
    const linea = texto.split(/\r?\n/).find((l) => l.startsWith('http_request_duration_seconds_count') && l.includes('route="/api/reservations"'));
    expect(linea).toContain('method="POST"');
    expect(linea).toContain('status="201"');
    expect(texto).toMatch(/planazo_uso_funcionalidad_total\{funcionalidad="reservations"/);
  });

  it('cuenta sesiones, consultas al agente y usuarios activos de los últimos 5 minutos', async () => {
    sesionesEmitidas.inc({ modo: 'negocio' });
    consultasAgente.inc({ fuente: 'plantilla' });
    registrarActividad('u-reciente');
    registrarActividad('u-viejo', Date.now() - 10 * 60_000);
    const texto = await registro.metrics();
    expect(texto).toMatch(/planazo_sesiones_emitidas_total\{modo="negocio"[^}]*\} 1/);
    expect(texto).toMatch(/planazo_consultas_agente_total\{fuente="plantilla"[^}]*\} 1/);
    expect(texto).toMatch(/planazo_usuarios_activos\{[^}]*\} 1/);
    expect(texto).toMatch(/service="api-gateway"/);
  });

  it('el servidor de métricas responde /metrics y nada más', async () => {
    const srv = servidorDeMetricas(0);
    await new Promise((r) => srv.once('listening', r));
    const { port } = srv.address() as AddressInfo;
    const ok = await fetch(`http://[::1]:${port}/metrics`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('process_cpu_user_seconds_total');
    expect((await fetch(`http://[::1]:${port}/otra`)).status).toBe(404);
    await new Promise((r) => srv.close(r));
  });
});
