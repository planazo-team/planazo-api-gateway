import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ProxyModule } from './proxy/proxy.module';
import { PlanModule } from './plan/plan.module';

@Module({
  imports: [AuthModule, ProxyModule, PlanModule],
})
export class AppModule {}
