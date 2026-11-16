import http from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { REPLICA, SERVICIO } from './replica';

/**
 * Métricas para Prometheus (Feature 10.4, Observabilidad). Se publican en un
 * puerto aparte (METRICS_PORT, 9464 por defecto) que solo alcanza la red
 * privada de Railway: el dominio público nunca sirve /metrics.
 * Cada serie lleva `service` e `instance`, así el tablero distingue réplicas.
 */
export const registro = new Registry();
registro.setDefaultLabels({ service: SERVICIO, instance: REPLICA });
collectDefaultMetrics({ register: registro });

const duracion = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duración de las peticiones HTTP atendidas',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registro],
});

const usoFuncionalidad = new Counter({
  name: 'planazo_uso_funcionalidad_total',
  help: 'Peticiones por funcionalidad de la app (lugares, reservas, promos, agente, juego…)',
  labelNames: ['funcionalidad'] as const,
  registers: [registro],
});

export const sesionesEmitidas = new Counter({
  name: 'planazo_sesiones_emitidas_total',
  help: 'Sesiones (JWT) emitidas por el gateway, por modo',
  labelNames: ['modo'] as const,
  registers: [registro],
});

export const consultasAgente = new Counter({
  name: 'planazo_consultas_agente_total',
  help: 'Planes pedidos al agente, según quién los armó',
  labelNames: ['fuente'] as const,
  registers: [registro],
});

export const ataquesDetectados = new Counter({
  name: 'planazo_ataques_detectados_total',
  help: 'IPs bloqueadas por ráfagas de 401/429 (detector de ataques)',
  registers: [registro],
});

/** Usuarios con actividad autenticada en los últimos 5 minutos (en esta réplica). */
const VENTANA_ACTIVOS_MS = 5 * 60_000;
const vistos = new Map<string, number>();
export function registrarActividad(userId: string, ahora = Date.now()) {
  vistos.set(userId, ahora);
}
new Gauge({
  name: 'planazo_usuarios_activos',
  help: 'Usuarios con actividad en los últimos 5 minutos',
  registers: [registro],
  collect() {
    const desde = Date.now() - VENTANA_ACTIVOS_MS;
    for (const [id, t] of vistos) if (t < desde) vistos.delete(id);
    this.set(vistos.size);
  },
});

/** La ruta como plantilla (`/api/places/:id`), nunca con ids reales: así no explota la cardinalidad. */
export function rutaDe(req: Request): string {
  const plantilla = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof plantilla === 'string') return `${req.baseUrl ?? ''}${plantilla}`.replace(/\*splat/g, '*');
  return 'sin_ruta';
}

/** /api/places/p1 → «places»; /api/auth/google → «auth». */
export function funcionalidadDe(url: string): string {
  const m = /^\/api\/([a-z-]+)/.exec(url.split('?')[0]);
  return m ? m[1] : 'otra';
}

export function medirHttp() {
  return (req: Request, res: Response, next: NextFunction) => {
    const fin = duracion.startTimer();
    res.on('finish', () => {
      fin({ method: req.method, route: rutaDe(req), status: String(res.statusCode) });
      usoFuncionalidad.inc({ funcionalidad: funcionalidadDe(req.originalUrl ?? req.url) });
    });
    next();
  };
}

/** Servidor de métricas en la red privada. Devuelve el servidor para poder cerrarlo. */
export function servidorDeMetricas(puerto = Number(process.env.METRICS_PORT ?? 9464)): http.Server {
  const srv = http.createServer((req, res) => {
    if (req.method !== 'GET' || (req.url ?? '').split('?')[0] !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    registro
      .metrics()
      .then((cuerpo) => res.writeHead(200, { 'content-type': registro.contentType }).end(cuerpo))
      .catch(() => res.writeHead(500).end());
  });
  srv.listen(puerto, '::');
  return srv;
}
