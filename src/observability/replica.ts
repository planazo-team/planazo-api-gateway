import { hostname } from 'node:os';

/**
 * Qué réplica atiende (ESC-04 y ESC-07). En Railway cada réplica trae su
 * RAILWAY_REPLICA_ID; en Docker o en local se usa el hostname del contenedor.
 * Se recorta a 8 caracteres seguros para mostrarlo en headers, logs y el panel.
 */
export function idReplica(env: NodeJS.ProcessEnv = process.env, host: string = hostname()): string {
  const crudo = env.RAILWAY_REPLICA_ID || env.HOSTNAME || host || '';
  return String(crudo).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8) || 'local';
}

export const SERVICIO = 'api-gateway';
export const REPLICA = idReplica();
/** Valor del header `x-served-by`: `servicio@réplica`. */
export const SERVIDO_POR = `${SERVICIO}@${REPLICA}`;
