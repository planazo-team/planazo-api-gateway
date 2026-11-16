import axios from 'axios';
import { Logger } from '@nestjs/common';
import { PlanService } from './plan.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const crear = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ beta: { messages: { create: crear } } })),
}));

const catalogo = [
  { id: 'p1', name: 'Resto Uno', category: 'restaurante', zone: 'zona-g', priceLevel: 2, freeSeats: 8, description: 'Cocina de autor' },
  { id: 'p2', name: 'Bar Dos', category: 'bar', zone: 'zona-t', freeSeats: 0 },
  { id: 'p3', name: 'Parque', category: 'aire-libre', zone: 'zona-g', freeSeats: null, priceLevel: 0 },
  { id: 'p4', name: 'Tejo', category: 'evento', zone: 'zona-t', freeSeats: 4 },
];

const respuesta = (texto: unknown, extra: Record<string, unknown> = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: typeof texto === 'string' ? texto : JSON.stringify(texto) }],
  ...extra,
});

describe('PlanService con Claude', () => {
  let service: PlanService;

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'clave-de-prueba';
  });
  afterAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    mockedAxios.get.mockResolvedValue({ status: 200, data: catalogo });
    service = new PlanService();
  });

  it('arma el plan con el modelo, completa nombres del catálogo y descarta ids inventados o repetidos', async () => {
    crear.mockResolvedValueOnce(
      respuesta({
        intro: 'Plan bacano',
        stops: [
          { placeId: 'p1', hour: '19:00', why: 'cena' },
          { placeId: 'p99', hour: '20:00', why: 'inventado' },
          { placeId: 'p1', hour: '20:30', why: 'repetido' },
          { placeId: 'p3', hour: '21:00', why: 'caminar' },
          { placeId: 'p4', hour: '22:00', why: 'tejo' },
          { placeId: 'p2', hour: '23:00', why: 'sobra' },
        ],
      }),
    );
    const plan = await service.buildPlan('plan con amigos');
    expect(plan.source).toBe('claude');
    expect(plan.intro).toBe('Plan bacano');
    expect(plan.stops.map((s) => s.placeId)).toEqual(['p1', 'p3', 'p4']);
    expect(plan.stops[0]).toMatchObject({ placeName: 'Resto Uno', category: 'restaurante' });

    // El catálogo que ve el modelo dice cupos, sin cupos o sin reserva según el lugar.
    const prompt = crear.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('p1 | Resto Uno | restaurante | zona-g | priceLevel 2 | 8 cupos | Cocina de autor');
    expect(prompt).toContain('p2 | Bar Dos | bar | zona-t | priceLevel ? | sin cupos |');
    expect(prompt).toContain('p3 | Parque | aire-libre | zona-g | priceLevel 0 | sin reserva |');
  });

  it.each([
    ['solo ids inventados', respuesta({ intro: 'x', stops: [{ placeId: 'nope', hour: '1', why: '' }] })],
    ['el modelo declina', respuesta('{}', { stop_reason: 'refusal' })],
    ['no hay bloque de texto', { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '...' }] }],
    ['JSON con otra forma', respuesta({ intro: 3, stops: 'no' })],
    ['JSON nulo', respuesta('null')],
  ])('si %s, responde con la plantilla', async (_caso, res) => {
    crear.mockResolvedValueOnce(res);
    const plan = await service.buildPlan('quiero comer rico');
    expect(plan.source).toBe('plantilla');
  });

  it('si la llamada falla (incluso con algo que no es Error) usa la plantilla', async () => {
    crear.mockRejectedValueOnce('timeout');
    expect((await service.buildPlan('cena')).source).toBe('plantilla');
    crear.mockRejectedValueOnce(new Error('500'));
    expect((await service.buildPlan('cena')).source).toBe('plantilla');
  });

  it('con catálogo vacío ni siquiera llama al modelo', async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: { no: 'es lista' } });
    const plan = await service.buildPlan('lo que sea');
    expect(crear).not.toHaveBeenCalled();
    expect(plan.stops).toEqual([]);
    expect(plan.intro).toMatch(/Aún no hay lugares/);
  });
});

describe('PlanService plantilla: cada tipo de plan', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    mockedAxios.get.mockResolvedValue({ status: 200, data: catalogo });
  });

  it.each([
    ['vamos a jugar tejo con cerveza', 'evento'],
    ['salida con amigos para un cumple', 'restaurante'],
    ['algo romántico con mi novia', 'restaurante'],
    ['tengo hambre, quiero comer', 'restaurante'],
    ['quiero un show de comedia', 'restaurante'],
    ['no sé, sorpréndeme', 'restaurante'],
  ])('«%s» arranca por %s', async (texto, primera) => {
    const plan = await new PlanService().buildPlan(texto);
    expect(plan.source).toBe('plantilla');
    expect(plan.stops[0].category).toBe(primera);
  });

  it('si ninguna categoría del plan tiene lugares, propone los dos primeros del catálogo', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: [
        { id: 'h1', name: 'Hotel', category: 'hotel', zone: 'zona-g' },
        { id: 'h2', name: 'Spa', category: 'spa', zone: 'zona-t', description: 'relax' },
      ],
    });
    const plan = await new PlanService().buildPlan('cena tranquila');
    expect(plan.stops.map((s) => [s.placeId, s.hour])).toEqual([
      ['h1', '19:30'],
      ['h2', '21:30'],
    ]);
  });
});
