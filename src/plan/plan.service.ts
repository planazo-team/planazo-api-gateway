import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { consultasAgente } from '../observability/metrics';

/**
 * Forma que espera el frontend (PlanResult en planazo-frontend/frontend/src/lib/types.ts).
 * Si cambia allá, cambia aquí.
 */
export interface PlanStop {
  placeId: string;
  placeName: string;
  category: string;
  hour: string;
  why: string;
}

export interface PlanResult {
  intro: string;
  stops: PlanStop[];
  /** Quién armó el plan: el modelo o la plantilla de respaldo. */
  source: 'claude' | 'plantilla';
}

interface CatalogPlace {
  id: string;
  name: string;
  category: string;
  zone: string;
  description?: string;
  priceLevel?: number;
  freeSeats?: number | null;
}

/** Lo que el modelo devuelve; se completa con el catálogo antes de responder. */
interface ModelPlan {
  intro: string;
  stops: Array<{ placeId: string; hour: string; why: string }>;
}

/** JSON Schema de la respuesta: con `output_config.format` el modelo no puede salirse de él. */
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    intro: { type: 'string', description: 'Una o dos frases que presentan el plan, en tono cercano.' },
    stops: {
      type: 'array',
      description: 'Entre 2 y 3 paradas en orden cronológico.',
      items: {
        type: 'object',
        properties: {
          placeId: { type: 'string', description: 'id exacto del catálogo, p. ej. p7' },
          hour: { type: 'string', description: 'Hora sugerida en formato HH:MM (24 h)' },
          why: { type: 'string', description: 'Por qué esta parada encaja con lo que pidió, en una frase.' },
        },
        required: ['placeId', 'hour', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['intro', 'stops'],
  additionalProperties: false,
} as const;

const SYSTEM = [
  'Eres el agente de Planazo, una app para armar salidas en la Zona G y la Zona T de Chapinero, Bogotá.',
  'Con lo que pide la persona propones una ruta de 2 o 3 paradas usando SOLO lugares del catálogo que recibes, en orden cronológico y a una hora realista para cada tipo de lugar.',
  'Ten en cuenta con quién va, el presupuesto (priceLevel 0 es gratis, 3 es caro) y el ánimo. Prefiere lugares con cupos libres; los que dicen "sin cupos" no los propongas.',
  'El catálogo también tiene parques públicos gratis (de día o al atardecer) y spots para parchar como tejo, karaoke, juegos de mesa, salsa o food trucks: mézclalos con restaurantes y bares para que cada plan sea distinto y no repitas siempre los mismos lugares.',
  'Escribe en español colombiano, cercano y breve. Nada de listas ni markdown dentro de los textos.',
].join(' ');

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);
  private readonly bookingUrl = (process.env.BOOKING_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5';
  private readonly client = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 })
    : null;

  async buildPlan(text: string): Promise<PlanResult> {
    const plan = await this.armarPlan(text);
    consultasAgente.inc({ fuente: plan.source });
    return plan;
  }

  private async armarPlan(text: string): Promise<PlanResult> {
    const places = await this.fetchCatalog();

    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY no configurada, usando plantilla.');
      return this.fallback(text, places);
    }
    if (places.length === 0) return this.fallback(text, places);

    try {
      const plan = await this.askClaude(text, places);
      const stops = this.resolve(plan.stops, places);
      if (stops.length === 0) return this.fallback(text, places);
      return { intro: plan.intro, stops, source: 'claude' };
    } catch (err) {
      this.logger.warn(`Claude falló (${err instanceof Error ? err.message : err}), usando plantilla.`);
      return this.fallback(text, places);
    }
  }

  /** Lee el catálogo de booking en modo solo lectura, con la llave del gateway. */
  private async fetchCatalog(): Promise<CatalogPlace[]> {
    try {
      const { data } = await axios.get(`${this.bookingUrl}/places`, {
        timeout: 5_000,
        headers: { 'x-gateway-key': process.env.GATEWAY_KEY ?? '', 'x-user-role': 'cliente', 'x-user-id': 'agent' },
      });
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private async askClaude(text: string, places: CatalogPlace[]): Promise<ModelPlan> {
    const catalog = places
      .map((p) => {
        const cupos = p.freeSeats === null || p.freeSeats === undefined ? 'sin reserva' : p.freeSeats > 0 ? `${p.freeSeats} cupos` : 'sin cupos';
        return `${p.id} | ${p.name} | ${p.category} | ${p.zone} | priceLevel ${p.priceLevel ?? '?'} | ${cupos} | ${p.description ?? ''}`;
      })
      .join('\n');

    // Opus 5.5 no acepta tool_choice forzado: la forma de la respuesta la garantiza
    // output_config.format (JSON que cumple el esquema). Si los clasificadores
    // declinan, `fallbacks: "default"` reintenta en el modelo recomendado.
    const res = await this.client!.beta.messages.create({
      model: this.model,
      max_tokens: 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Catálogo (id | nombre | categoría | zona | precio | cupos | descripción):\n${catalog}\n\nLo que pidió la persona: "${text}"`,
        },
      ],
    });

    if (res.stop_reason === 'refusal') throw new Error('el modelo declinó la solicitud');
    const block = res.content.find((c): c is Anthropic.Beta.BetaTextBlock => c.type === 'text');
    if (!block) throw new Error('respuesta sin texto');
    const parsed = JSON.parse(block.text) as ModelPlan;
    if (!parsed || typeof parsed.intro !== 'string' || !Array.isArray(parsed.stops)) {
      throw new Error('respuesta con forma inesperada');
    }
    return parsed;
  }

  /** Completa nombre y categoría desde el catálogo y descarta ids inventados por el modelo. */
  private resolve(stops: ModelPlan['stops'], places: CatalogPlace[]): PlanStop[] {
    const byId = new Map(places.map((p) => [p.id, p]));
    const seen = new Set<string>();
    return stops
      .map((s) => {
        const p = byId.get(String(s.placeId));
        if (!p || seen.has(p.id)) return null;
        seen.add(p.id);
        return { placeId: p.id, placeName: p.name, category: p.category, hour: String(s.hour), why: String(s.why) };
      })
      .filter((s): s is PlanStop => s !== null)
      .slice(0, 3);
  }

  /**
   * Sin llave, si el modelo falla o declina: una plantilla que sí lee la frase.
   * Elige el orden de categorías por palabras clave y toma lugares con cupo.
   */
  private fallback(text: string, places: CatalogPlace[]): PlanResult {
    const t = text.toLowerCase();
    const has = (...ws: string[]) => ws.some((w) => t.includes(w));
    const barato = has('barato', 'plata', 'poca', 'económic', 'economic', 'gratis', 'presupuesto');

    let order: string[];
    let intro: string;
    if (has('parque', 'caminar', 'picnic', 'aire libre', 'naturaleza', 'sendero', 'cicl', 'yoga', 'de día', 'de dia', 'domingo')) {
      order = ['aire-libre', 'restaurante', 'bar'];
      intro = 'Arrancamos al aire libre, seguimos con algo de comer y cerramos con un trago.';
    } else if (has('tejo', 'karaoke', 'juegos', 'billar', 'trivia', 'cerveza', 'chela', 'pola')) {
      order = ['evento', 'bar', 'restaurante'];
      intro = 'Plan de parche: algo para competir, cerveza y comida para cerrar.';
    } else if (has('rumba', 'bailar', 'fiesta', 'discoteca', 'farra', 'perrear', 'salsa')) {
      order = ['restaurante', 'bar', 'discoteca'];
      intro = 'Comida para coger fuerza, un trago para calentar y cerramos bailando en la Zona T.';
    } else if (has('amigos', 'parche', 'grupo', 'somos', 'cumple')) {
      order = ['restaurante', 'evento', 'bar'];
      intro = 'Para ir en parche prioricé sitios con cupo real para varios, todo a pocas cuadras.';
    } else if (barato) {
      order = ['aire-libre', 'restaurante'];
      intro = 'Un plan que casi no cuesta: algo gratis para empezar y comida barata para cerrar.';
    } else if (has('novia', 'novio', 'pareja', 'cita', 'aniversario', 'romant', 'tranquil')) {
      order = ['restaurante', 'bar'];
      intro = 'Algo tranquilo para dos: cena sin afán y un trago en terraza para cerrar.';
    } else if (has('comer', 'cenar', 'hambre', 'comida', 'almorzar')) {
      order = ['restaurante', 'restaurante'];
      intro = 'Enfocado en comer bien, en la Zona G.';
    } else if (has('reír', 'reir', 'comedia', 'show', 'jazz', 'música', 'musica', 'concierto')) {
      order = ['restaurante', 'evento', 'bar'];
      intro = 'Cena, show en vivo y un trago para comentarlo.';
    } else {
      order = ['restaurante', 'bar'];
      intro = 'Te propongo un plan clásico: cena en la Zona G y un trago en la Zona T.';
    }

    const hours: Record<string, string> = {
      'aire-libre': '17:00',
      restaurante: '19:30',
      evento: '21:00',
      bar: '22:00',
      discoteca: '23:30',
      hotel: '23:59',
    };
    const used = new Set<string>();
    const stops: PlanStop[] = [];
    for (const cat of order) {
      const options = places
        .filter((p) => p.category === cat && !used.has(p.id) && (p.freeSeats ?? 1) > 0)
        .sort((a, b) => (barato ? (a.priceLevel ?? 2) - (b.priceLevel ?? 2) : (b.freeSeats ?? 0) - (a.freeSeats ?? 0)));
      // Uno de los tres mejores, para que dos personas no reciban siempre el mismo plan.
      const p = options[Math.floor(Math.random() * Math.min(3, options.length))];
      if (!p) continue;
      used.add(p.id);
      stops.push({ placeId: p.id, placeName: p.name, category: p.category, hour: hours[cat] ?? '20:00', why: p.description ?? '' });
    }
    if (stops.length === 0 && places.length > 0) {
      places.slice(0, 2).forEach((p, i) =>
        stops.push({ placeId: p.id, placeName: p.name, category: p.category, hour: i ? '21:30' : '19:30', why: p.description ?? '' }),
      );
    }
    return {
      intro: stops.length ? intro : 'Aún no hay lugares cargados en el catálogo. Intenta más tarde.',
      stops,
      source: 'plantilla',
    };
  }
}
