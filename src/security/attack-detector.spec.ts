import { AttackDetector } from './attack-detector';
import type { Request, Response } from 'express';
import { EventEmitter } from 'events';

describe('AttackDetector', () => {
  let detector: AttackDetector;

  beforeEach(() => {
    detector = new AttackDetector({
      umbralErrores: 3,
      ventanaSegundos: 2,
      duracionBloqueoSegundos: 5,
    });
  });

  afterEach(() => {
    detector.cerrar();
  });

  it('usa la IP que resolvió Express (trust proxy) y no confía en X-Forwarded-For del cliente', () => {
    const falsificada = { headers: { 'x-forwarded-for': '203.0.113.195' }, ip: '198.51.100.1' } as unknown as Request;
    expect(detector.obtenerIp(falsificada)).toBe('198.51.100.1');

    const soloSocket = { headers: { 'x-forwarded-for': '203.0.113.195' }, socket: { remoteAddress: '192.168.1.5' } } as unknown as Request;
    expect(detector.obtenerIp(soloSocket)).toBe('192.168.1.5');

    const nada = { headers: {} } as unknown as Request;
    expect(detector.obtenerIp(nada)).toBe('127.0.0.1');
  });

  it('no debe bloquear una IP con menos fallos que el umbral', async () => {
    const ip = '1.2.3.4';
    expect(await detector.estaBloqueada(ip)).toBe(false);

    await detector.registrarFallo(ip);
    await detector.registrarFallo(ip);

    expect(await detector.estaBloqueada(ip)).toBe(false);
  });

  it('debe bloquear la IP al superar el umbral de fallos 401/429', async () => {
    const ip = '5.6.7.8';
    await detector.registrarFallo(ip);
    await detector.registrarFallo(ip);
    await detector.registrarFallo(ip);

    // El 4to fallo supera el umbral (3)
    const res = await detector.registrarFallo(ip);
    expect(res.bloqueada).toBe(true);
    expect(await detector.estaBloqueada(ip)).toBe(true);
  });

  it('el middleware debe responder 429 si la IP está bloqueada', async () => {
    const ip = '9.10.11.12';
    // Bloquear IP
    for (let i = 0; i < 4; i++) {
      await detector.registrarFallo(ip);
    }

    const req = { headers: {}, ip } as unknown as Request;
    const jsonMock = jest.fn();
    const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    const res = { status: statusMock } as unknown as Response;
    const next = jest.fn();

    const mw = detector.middleware();
    await mw(req, res, next);

    expect(statusMock).toHaveBeenCalledWith(429);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'IP_BLOQUEADA',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('el middleware debe registrar fallos si status es 401 o 429', async () => {
    const ip = '13.14.15.16';
    const req = { headers: {}, ip } as unknown as Request;

    const resEmitter = new EventEmitter() as any;
    resEmitter.statusCode = 401;
    const next = jest.fn();

    const mw = detector.middleware();
    await mw(req, resEmitter as Response, next);

    expect(next).toHaveBeenCalled();

    // Disparar evento finish
    resEmitter.emit('finish');
    // Esperar tick
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await detector.estaBloqueada(ip)).toBe(false);
  });

  it('debe funcionar correctamente con cliente Redis simulado', async () => {
    const mockRedis = {
      exists: jest.fn().mockResolvedValue(1),
      incr: jest.fn().mockResolvedValue(55),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    } as any;

    (detector as any).redis = mockRedis;

    expect(await detector.estaBloqueada('10.0.0.1')).toBe(true);
    expect(mockRedis.exists).toHaveBeenCalledWith('ip:blocked:10.0.0.1');

    const res = await detector.registrarFallo('10.0.0.1');
    expect(res.bloqueada).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith('ip:blocked:10.0.0.1', '1', 'EX', 5);
  });
});
