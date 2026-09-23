export type Role = 'cliente' | 'negocio';

export interface SeedUser {
  id: string;
  name: string;
  role: Role;
  placeId?: string;
}

/**
 * Debe coincidir exactamente con DEMO_USERS en
 * planazo-frontend/frontend/src/lib/session.ts
 */
export const SEED_USERS: SeedUser[] = [
  { id: 'u1', name: 'Juan Diego', role: 'cliente' },
  { id: 'u2', name: 'Valentina', role: 'cliente' },
  { id: 'u3', name: 'Camilo', role: 'cliente' },
  { id: 'u4', name: 'Sara', role: 'cliente' },
  { id: 'u5', name: 'Andrés', role: 'cliente' },
  { id: 'u6', name: 'Laura', role: 'cliente' },
  { id: 'b1', name: 'Bar El Zaguán', role: 'negocio', placeId: 'p7' },
  { id: 'b2', name: 'Fideos de la Nona', role: 'negocio', placeId: 'p1' },
  { id: 'b3', name: 'Terraza 85', role: 'negocio', placeId: 'p8' },
];
