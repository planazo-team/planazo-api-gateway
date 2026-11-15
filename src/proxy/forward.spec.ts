import axios from 'axios';
import type { Request, Response } from 'express';
import { breakers, forward, getCircuitBreaker } from './forward';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Proxy forward con Circuit Breaker (HU-118 - ESC-04)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    breakers.clear();
  });

  function mockReqRes(method: string, originalUrl: string, body: any = {}) {
    const req = {
      method,
      originalUrl,
      body,
      headers: {
        'x-request-id': 'req-123',
      },
    } as unknown as Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;

    return { req, res };
  }

  it('debe reenviar peticion exitosa con status y datos del servicio', async () => {
    mockedAxios.request.mockResolvedValueOnce({
      status: 200,
      data: [{ id: 'p1', name: 'Bar 1' }],
    } as any);

    const { req, res } = mockReqRes('GET', '/api/places');
    await forward('http://booking:3001', req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ id: 'p1', name: 'Bar 1' }]);
  });

  it('debe reintentar peticion GET si falla en el primer intento y responder 200 si el segundo tiene éxito', async () => {
    mockedAxios.request
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        status: 200,
        data: { ok: true },
      } as any);

    const { req, res } = mockReqRes('GET', '/api/promos');
    await forward('http://promo:3002', req, res);

    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('no debe reintentar peticiones no idempotentes (POST) ante fallos', async () => {
    mockedAxios.request.mockRejectedValueOnce(new Error('Connection refused'));

    const { req, res } = mockReqRes('POST', '/api/reservations', { people: 2 });
    await forward('http://booking:3001', req, res);

    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SERVICIO_NO_DISPONIBLE',
      }),
    );
  });

  it('debe responder 503 SERVICIO_NO_DISPONIBLE si el circuit breaker rechaza la petición', async () => {
    const breaker = getCircuitBreaker('http://booking:3001');
    jest.spyOn(breaker, 'fire').mockRejectedValueOnce(new Error('Breaker open'));

    const { req, res } = mockReqRes('GET', '/api/places');
    await forward('http://booking:3001', req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      code: 'SERVICIO_NO_DISPONIBLE',
      message: 'El servicio http://booking:3001 no está disponible en este momento.',
    });
  });
});
