import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

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
}

interface CatalogPlace {
  id: string;
  name: string;
  category: string;
  zone: string;
  description?: string;
  freeSeats?: number | null;
}

/** Lo que el modelo devuelve por tool use; se completa con el catálogo antes de responder. */
interface ModelStop {
  placeId: string;
  hour: string;
  why: string;
}

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);
  private readonly bookingUrl = (process.env.BOOKING_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  private readonly apiKey = process.env.ANTHROPIC_API_KEY;
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

  async buildPlan(text: string): Promise<PlanResult> {
    const places = await this.fetchCatalog();

    if (!this.apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY no configurada, usando plantilla.');
      return this.fallback(places);
    }

    try {
      const { intro, stops } = await this.askClaude(text, places);
      const resolved = this.resolve(stops, places);
      if (resolved.length === 0) return this.fallback(places);
      return { intro, stops: resolved };
    } catch (err) {
      this.logger.warn(`Claude falló (${err}), usando plantilla.`);
      return this.fallback(places);
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

  private async askClaude(text: string, places: CatalogPlace[]): Promise<{ intro: string; stops: ModelStop[] }> {
    const catalog = places
      .map((p) => `${p.id}: ${p.name} (${p.category}, ${p.zone})${p.description ? ` — ${p.description}` : ''}`)
      .join('\n');

    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: this.model,
        max_tokens: 700,
        system:
          'Eres el agente de Planazo, una app para armar planes en Zona G y Zona T de Bogotá. ' +
          'Propones rutas de 2 a 3 paradas usando SOLO lugares del catálogo que te dan, en orden cronológico. ' +
          'Respondes en español, cercano y breve.',
        messages: [
          {
            role: 'user',
            content: `Un usuario pidió este plan: "${text}".\n\nCatálogo disponible:\n${catalog}`,
          },
        ],
        tools: [
          {
            name: 'proponer_ruta',
            description: 'Propone entre 2 y 3 paradas para el plan del usuario',
            input_schema: {
              type: 'object',
              properties: {
                intro: { type: 'string', description: 'Una frase que presenta el plan' },
                stops: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      placeId: { type: 'string', description: 'id exacto del catálogo, p. ej. p7' },
                      hour: { type: 'string', description: 'Hora sugerida, formato HH:MM' },
                      why: { type: 'string', description: 'Por qué encaja con lo que pidió' },
                    },
                    required: ['placeId', 'hour', 'why'],
                  },
                },
              },
              required: ['intro', 'stops'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'proponer_ruta' },
      },
      {
        timeout: 20_000,
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      },
    );

    const toolUse = res.data.content.find((c: { type: string }) => c.type === 'tool_use');
    return {
      intro: toolUse?.input?.intro ?? 'Este es el plan que te propongo.',
      stops: toolUse?.input?.stops ?? [],
    };
  }

  /** Completa nombre y categoría desde el catálogo y descarta ids inventados por el modelo. */
  private resolve(stops: ModelStop[], places: CatalogPlace[]): PlanStop[] {
    const byId = new Map(places.map((p) => [p.id, p]));
    return stops
      .map((s) => {
        const p = byId.get(s.placeId);
        return p ? { placeId: p.id, placeName: p.name, category: p.category, hour: s.hour, why: s.why } : null;
      })
      .filter((s): s is PlanStop => s !== null)
      .slice(0, 3);
  }

  /** Sin llave de Claude, si el modelo falla o no hay catálogo: los primeros lugares disponibles. */
  private fallback(places: CatalogPlace[]): PlanResult {
    const hours = ['19:00', '21:00', '23:00'];
    const stops = places.slice(0, 2).map((p, i) => ({
      placeId: p.id,
      placeName: p.name,
      category: p.category,
      hour: hours[i] ?? '20:00',
      why: 'Sugerencia del catálogo mientras el agente no está disponible.',
    }));
    return {
      intro: stops.length
        ? 'El agente no está disponible ahora; te dejo dos opciones del catálogo para empezar.'
        : 'Aún no hay lugares cargados en el catálogo. Intenta más tarde.',
      stops,
    };
  }
}
