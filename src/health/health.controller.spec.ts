import axios from 'axios';
import { HealthController, sondear } from './health.controller';

jest.mock('axios');
const get = axios.get as jest.MockedFunction<typeof axios.get>;

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
    get.mockReset();
  });

  it('debe responder status UP, la réplica y los upstreams configurados', () => {
    const res = controller.health();
    expect(res.service).toBe('planazo-api-gateway');
    expect(res.status).toBe('UP');
    expect(typeof res.replica).toBe('string');
    expect(res.upstreams).toHaveProperty('booking');
    expect(res.upstreams).toHaveProperty('promo');
    expect(res.upstreams).toHaveProperty('game');
  });

  it('sondear toma la réplica del header x-served-by', async () => {
    get.mockResolvedValueOnce({ status: 200, headers: { 'x-served-by': 'booking@r1' }, data: {} });
    const e = await sondear('booking', 'http://booking/health');
    expect(e).toMatchObject({ servicio: 'booking', ok: true, status: 200, replica: 'booking@r1' });
  });

  it('sondear usa el campo replica del cuerpo si no hay header', async () => {
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: { replica: 'abcd1234' } });
    const e = await sondear('promo', 'http://promo/health');
    expect(e.replica).toBe('promo@abcd1234');
  });

  it('sondear marca caído un servicio que no responde, sin lanzar', async () => {
    get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const e = await sondear('game', 'http://game/actuator/health');
    expect(e).toMatchObject({ servicio: 'game', ok: false, status: null, replica: null });
  });

  it('cluster informa la réplica del gateway y el estado de cada servicio', async () => {
    get
      .mockResolvedValueOnce({ status: 200, headers: { 'x-served-by': 'booking@r1' }, data: {} })
      .mockResolvedValueOnce({ status: 503, headers: {}, data: {} })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { status: 'UP' } });
    const res = await controller.cluster();
    expect(res.gateway).toMatch(/^api-gateway@/);
    expect(res.servicios.map((s) => [s.servicio, s.ok])).toEqual([
      ['booking', true],
      ['promo', false],
      ['game', true],
    ]);
  });
});
