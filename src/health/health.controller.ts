import { Controller, Get } from '@nestjs/common';

const startedAt = Date.now();

/** GET /api/health — sin token. Lo usan Railway, el docker-compose de planazo-infra y status.sh. */
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      service: 'planazo-api-gateway',
      status: 'UP',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      upstreams: {
        booking: process.env.BOOKING_URL ?? 'http://localhost:3001',
        promo: process.env.PROMO_URL ?? 'http://localhost:3002',
        game: process.env.GAME_URL ?? 'http://localhost:3003',
      },
    };
  }
}
