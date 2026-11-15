import { BadRequestException } from '@nestjs/common';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';

describe('PlanController', () => {
  let controller: PlanController;
  let service: jest.Mocked<PlanService>;

  beforeEach(() => {
    service = {
      buildPlan: jest.fn(),
    } as unknown as jest.Mocked<PlanService>;
    controller = new PlanController(service);
  });

  it('debe rechazar textos vacíos o menores a 3 caracteres con BadRequestException', async () => {
    expect(() => controller.create('')).toThrow(BadRequestException);
    expect(() => controller.create('hi')).toThrow(BadRequestException);
  });

  it('debe llamar a service.buildPlan con texto válido', async () => {
    const mockRes = { intro: 'Intro', stops: [], source: 'plantilla' as const };
    service.buildPlan.mockResolvedValueOnce(mockRes);

    const res = await controller.create('Quiero salir a bailar y comer rico');
    expect(service.buildPlan).toHaveBeenCalledWith('Quiero salir a bailar y comer rico');
    expect(res).toBe(mockRes);
  });
});
