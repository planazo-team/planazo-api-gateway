import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanService } from './plan.service';

@UseGuards(JwtAuthGuard)
@Controller('plan')
export class PlanController {
  constructor(private plan: PlanService) {}

  /**
   * POST /api/plan { text } → PlanResult { intro, stops: [{ placeId, placeName, category, hour, why }] }
   * La forma es la de `PlanResult` en planazo-frontend/frontend/src/lib/types.ts.
   */
  @Post()
  create(@Body('text') text: string) {
    if (typeof text !== 'string' || text.trim().length < 3) {
      throw new BadRequestException({ code: 'TEXTO_INVALIDO', message: 'Cuéntanos qué plan quieres en una frase.' });
    }
    return this.plan.buildPlan(text.trim().slice(0, 500));
  }
}
