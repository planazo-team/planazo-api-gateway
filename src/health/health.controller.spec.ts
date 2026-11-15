import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('debe responder status UP y upstreams configurados', () => {
    const res = controller.health();
    expect(res.service).toBe('planazo-api-gateway');
    expect(res.status).toBe('UP');
    expect(res.upstreams).toHaveProperty('booking');
    expect(res.upstreams).toHaveProperty('promo');
    expect(res.upstreams).toHaveProperty('game');
  });
});
