import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanService } from './plan.service';

@UseGuards(JwtAuthGuard)
@Controller('plan')
export class PlanController {
  constructor(private plan: PlanService) {}

  /** POST /api/plan { text } → { stops: [{ place_id, hour, why }] } */
  @Post()
  create(@Body('text') text: string) {
    return this.plan.buildPlan(text);
  }
}
