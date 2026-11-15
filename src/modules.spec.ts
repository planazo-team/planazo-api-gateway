import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PlanModule } from './plan/plan.module';
import { ProxyModule } from './proxy/proxy.module';

describe('Nest Modules', () => {
  it('debe inicializar AuthModule', async () => {
    const module = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('debe inicializar HealthModule', async () => {
    const module = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('debe inicializar PlanModule', async () => {
    const module = await Test.createTestingModule({
      imports: [PlanModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('debe inicializar ProxyModule', async () => {
    const module = await Test.createTestingModule({
      imports: [ProxyModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('debe inicializar AppModule completo', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(module).toBeDefined();
  });
});
