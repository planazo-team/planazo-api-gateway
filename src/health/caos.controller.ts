import { Controller, Headers, HttpCode, Logger, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { SERVIDO_POR } from '../observability/replica';

const logger = new Logger('Caos');

/** Cuánto espera la réplica antes de salir, para alcanzar a responder. */
export const ESPERA_ANTES_DE_SALIR_MS = 300;

/** Compara la llave sin filtrar por tiempos cuánto de ella acertó quien llama. */
function llaveValida(dada: string | undefined, esperada: string): boolean {
  const a = Buffer.from(dada ?? '');
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/health/caos — prueba de caos del ESC-04 para la demo.
 * Apaga la réplica del gateway que recibe la petición (sale con código 1).
 * Railway la reinicia sola (restartPolicy ON_FAILURE) y, mientras tanto, la
 * otra réplica sigue atendiendo: el panel /estado muestra el respaldo en vivo.
 *
 * Solo existe si DEMO_LOGIN_KEY está definida, y exige esa llave en `x-demo-key`.
 */
@Controller('health')
export class CaosController {
  /** Inyectable para las pruebas: en producción termina el proceso. */
  static salir: (codigo: number) => void = (codigo) => process.exit(codigo);

  @Post('caos')
  @HttpCode(202)
  caos(@Headers('x-demo-key') llave?: string) {
    const esperada = process.env.DEMO_LOGIN_KEY;
    if (!esperada) throw new NotFoundException();
    if (!llaveValida(llave, esperada)) {
      throw new UnauthorizedException({ code: 'LLAVE_INVALIDA', message: 'Llave de demo inválida.' });
    }
    logger.warn(`[CAOS] ${SERVIDO_POR} se apaga a propósito (prueba de respaldo ESC-04).`);
    setTimeout(() => CaosController.salir(1), ESPERA_ANTES_DE_SALIR_MS).unref?.();
    return { apagada: SERVIDO_POR, mensaje: 'Esta réplica se apaga; la plataforma la reinicia y las demás siguen atendiendo.' };
  }
}
