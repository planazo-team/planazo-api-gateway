import { Module } from '@nestjs/common';
import { CaosController } from './caos.controller';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController, CaosController] })
export class HealthModule {}
