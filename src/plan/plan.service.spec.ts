import axios from 'axios';
import { PlanService } from './plan.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PlanService', () => {
  let service: PlanService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlanService();
  });

  it('debe generar un plan con plantilla si no hay ANTHROPIC_API_KEY', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: [
        { id: 'p1', name: 'Restaurante A', category: 'restaurante', zone: 'zona-g', freeSeats: 10, description: 'Rica comida' },
        { id: 'p2', name: 'Bar B', category: 'bar', zone: 'zona-t', freeSeats: 5, description: 'Buenos cócteles' },
      ],
    });

    const result = await service.buildPlan('quiero cenar y tomar un trago con mi pareja');
    expect(result.source).toBe('plantilla');
    expect(result.stops.length).toBeGreaterThanOrEqual(1);
    expect(result.stops[0]).toHaveProperty('placeId');
    expect(result.stops[0]).toHaveProperty('placeName');
  });

  it('debe clasificar planes para rumba / fiesta', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: [
        { id: 'p1', name: 'Resto 1', category: 'restaurante', zone: 'zona-t', freeSeats: 10 },
        { id: 'p2', name: 'Disco 1', category: 'discoteca', zone: 'zona-t', freeSeats: 20 },
        { id: 'p3', name: 'Bar 1', category: 'bar', zone: 'zona-t', freeSeats: 5 },
      ],
    });

    const result = await service.buildPlan('vamos de rumba y fiesta a bailar con amigos');
    expect(result.source).toBe('plantilla');
    expect(result.intro).toContain('bailando');
  });

  it('debe clasificar planes al aire libre / parque', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: [
        { id: 'p1', name: 'Parque Virrey', category: 'aire-libre', zone: 'zona-t', freeSeats: 100 },
        { id: 'p2', name: 'Cafe', category: 'restaurante', zone: 'zona-t', freeSeats: 10 },
      ],
    });

    const result = await service.buildPlan('quiero caminar en el parque y hacer picnic de dia');
    expect(result.source).toBe('plantilla');
    expect(result.intro).toContain('aire libre');
  });

  it('debe clasificar planes baratos / económicos', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: [
        { id: 'p1', name: 'Parque', category: 'aire-libre', zone: 'zona-t', priceLevel: 0, freeSeats: 10 },
        { id: 'p2', name: 'Empanadas', category: 'restaurante', zone: 'zona-t', priceLevel: 1, freeSeats: 5 },
      ],
    });

    const result = await service.buildPlan('algo economico y barato con poco presupuesto');
    expect(result.source).toBe('plantilla');
    expect(result.intro).toContain('casi no cuesta');
  });

  it('debe manejar catálogo vacío o fallo de red sin romper', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

    const result = await service.buildPlan('algo tranquilo');
    expect(result.source).toBe('plantilla');
    expect(result.stops).toHaveLength(0);
  });
});
