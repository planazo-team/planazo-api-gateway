import { Controller, Get } from '@nestjs/common';
import axios from 'axios';
import { Agent } from 'node:http';
import { REPLICA, SERVIDO_POR } from '../observability/replica';

const startedAt = Date.now();

/** Sin keep-alive: cada sondeo abre conexión nueva y puede caer en otra réplica del servicio. */
const agente = new Agent({ keepAlive: false });
const TIMEOUT_SONDEO_MS = Number(process.env.CLUSTER_PROBE_TIMEOUT_MS ?? 2000);

export interface EstadoServicio {
  servicio: string;
  ok: boolean;
  status: number | null;
  ms: number;
  /** Réplica que respondió (`servicio@réplica`), si el servicio la informa. */
  replica: string | null;
}

function upstreams() {
  return {
    booking: process.env.BOOKING_URL ?? 'http://localhost:3001',
    promo: process.env.PROMO_URL ?? 'http://localhost:3002',
    game: process.env.GAME_URL ?? 'http://localhost:3003',
  };
}

/** Pregunta /health a un servicio interno y anota quién respondió y cuánto tardó. */
export async function sondear(servicio: string, url: string, timeoutMs = TIMEOUT_SONDEO_MS): Promise<EstadoServicio> {
  const t0 = Date.now();
  try {
    const r = await axios.get(url, { timeout: timeoutMs, httpAgent: agente, validateStatus: () => true });
    const cabecera = r.headers?.['x-served-by'];
    const cuerpo = (r.data ?? {}) as { replica?: unknown };
    let replica: string | null = null;
    if (typeof cabecera === 'string') replica = cabecera.slice(0, 64);
    else if (typeof cuerpo.replica === 'string') replica = `${servicio}@${cuerpo.replica.slice(0, 16)}`;
    return { servicio, ok: r.status >= 200 && r.status < 300, status: r.status, ms: Date.now() - t0, replica };
  } catch {
    return { servicio, ok: false, status: null, ms: Date.now() - t0, replica: null };
  }
}

/** GET /api/health — sin token. Lo usan Railway, el docker-compose de planazo-infra y status.sh. */
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      service: 'planazo-api-gateway',
      status: 'UP',
      version: process.env.npm_package_version ?? '0.1.0',
      replica: REPLICA,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      upstreams: upstreams(),
    };
  }

  /**
   * GET /api/health/cluster — sin token. Muestra qué réplica del gateway atendió y,
   * detrás de ella, qué réplica de cada servicio interno respondió (ESC-04). Lo usa
   * el panel /estado del frontend para ver el balanceo y el respaldo en vivo.
   */
  @Get('cluster')
  async cluster() {
    const u = upstreams();
    const servicios = await Promise.all([
      sondear('booking', `${u.booking}/health`),
      sondear('promo', `${u.promo}/health`),
      sondear('game', `${u.game}/actuator/health`),
    ]);
    return { gateway: SERVIDO_POR, at: Date.now(), servicios };
  }
}
