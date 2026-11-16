import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CaosController, ESPERA_ANTES_DE_SALIR_MS } from './caos.controller';

describe('CaosController (prueba de caos ESC-04)', () => {
  const original = process.env.DEMO_LOGIN_KEY;
  let salir: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    salir = jest.fn();
    CaosController.salir = salir;
  });

  afterEach(() => {
    jest.useRealTimers();
    if (original === undefined) delete process.env.DEMO_LOGIN_KEY;
    else process.env.DEMO_LOGIN_KEY = original;
  });

  it('no existe si no hay DEMO_LOGIN_KEY', () => {
    delete process.env.DEMO_LOGIN_KEY;
    expect(() => new CaosController().caos('lo-que-sea')).toThrow(NotFoundException);
    expect(salir).not.toHaveBeenCalled();
  });

  it('rechaza una llave equivocada o ausente y no apaga nada', () => {
    process.env.DEMO_LOGIN_KEY = 'llave-de-demo-segura';
    const c = new CaosController();
    expect(() => c.caos('otra')).toThrow(UnauthorizedException);
    expect(() => c.caos(undefined)).toThrow(UnauthorizedException);
    jest.advanceTimersByTime(ESPERA_ANTES_DE_SALIR_MS * 2);
    expect(salir).not.toHaveBeenCalled();
  });

  it('con la llave correcta responde quién se apaga y sale con código 1 después de responder', () => {
    process.env.DEMO_LOGIN_KEY = 'llave-de-demo-segura';
    const r = new CaosController().caos('llave-de-demo-segura');
    expect(r.apagada).toMatch(/^api-gateway@/);
    expect(salir).not.toHaveBeenCalled();
    jest.advanceTimersByTime(ESPERA_ANTES_DE_SALIR_MS);
    expect(salir).toHaveBeenCalledWith(1);
  });
});
