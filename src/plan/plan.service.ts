import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

interface Stop {
  place_id: string;
  hour: string;
  why: string;
}

interface CatalogPlace {
  id: string;
  name: string;
  category: string;
  zone: string;
}

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);
  private readonly bookingUrl = (process.env.BOOKING_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  private readonly apiKey = process.env.ANTHROPIC_API_KEY;
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

  async buildPlan(text: string): Promise<{ stops: Stop[] }> {
    const places = await this.fetchCatalog();

    if (!this.apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY no configurada, usando plantilla.');
      return { stops: this.fallback(places) };
    }

    try {
      return { stops: await this.askClaude(text, places) };
    } catch (err) {
      this.logger.warn(`Claude falló (${err}), usando plantilla.`);
      return { stops: this.fallback(places) };
    }
  }

  private async fetchCatalog(): Promise<CatalogPlace[]> {
    try {
      const { data } = await axios.get(`${this.bookingUrl}/places`);
      return data;
    } catch {
      return [];
    }
  }

  private async askClaude(text: string, places: CatalogPlace[]): Promise<Stop[]> {
    const catalog = places.map((p) => `${p.id}: ${p.name} (${p.category}, ${p.zone})`).join('\n');

    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: this.model,
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `Un usuario pidió este plan: "${text}". Elige entre 2 y 3 lugares de este catálogo que encajen:\n${catalog}`,
          },
        ],
        tools: [
          {
            name: 'proponer_ruta',
            description: 'Propone entre 2 y 3 paradas para el plan del usuario',
            input_schema: {
              type: 'object',
              properties: {
                stops: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      place_id: { type: 'string' },
                      hour: { type: 'string' },
                      why: { type: 'string' },
                    },
                    required: ['place_id', 'hour', 'why'],
                  },
                },
              },
              required: ['stops'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'proponer_ruta' },
      },
      {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      },
    );

    const toolUse = res.data.content.find((c: { type: string }) => c.type === 'tool_use');
    return toolUse?.input?.stops ?? [];
  }

  /** Sin llave de Claude o si el modelo falla: los primeros lugares del catálogo. */
  private fallback(places: CatalogPlace[]): Stop[] {
    return places.slice(0, 2).map((p) => ({
      place_id: p.id,
      hour: '20:00',
      why: 'Sugerencia del catálogo mientras el agente no está disponible.',
    }));
  }
}
