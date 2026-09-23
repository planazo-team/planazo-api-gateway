# planazo-api-gateway

Único punto de entrada HTTP de Planazo. Valida el JWT fijo de los usuarios semilla, aplica un límite de peticiones por IP, y reenvía cada ruta al microservicio dueño. `agent` vive aquí dentro como un módulo — no tiene repo propio (ver [`planazo-frontend/docs/arquitectura.md`](https://github.com/planazo-team/planazo-frontend/blob/main/docs/arquitectura.md)).

**No tiene base de datos ni lógica de negocio propia**, salvo firmar el JWT y armar el plan del agente.

---

## Rutas

| Ruta | Va a | Auth |
|---|---|---|
| `POST /api/auth/demo` | el propio gateway (firma el JWT) | pública |
| `GET/POST/PATCH /api/places*` | `booking` | requiere token |
| `* /api/reservations*` | `booking` | requiere token |
| `* /api/events*` | `booking` | requiere token |
| `* /api/promos*` | `promo` | requiere token |
| `* /api/rooms*` | `game` | requiere token |
| `POST /api/plan` | módulo `agent` (interno) | requiere token |

`realtime` **no pasa por aquí**: el frontend se conecta a su WebSocket directamente (ver `NEXT_PUBLIC_REALTIME_URL` en el frontend).

---

## Correr en local

```bash
npm install
cp .env.example .env
npm run start:dev
```

Levanta en `http://localhost:8080`. Sin `BOOKING_URL`/`PROMO_URL`/`GAME_URL` configurados apunta a `localhost:3001/3002/3003` — si esos servicios no están corriendo, el gateway responde `502` controlado (no se cae).

### Probar sin nada más levantado

```bash
# login de un usuario semilla
curl -X POST http://localhost:8080/api/auth/demo -H "Content-Type: application/json" -d '{"userId":"u1"}'
# → { "token": "..." }

# usar el token en una ruta protegida
curl http://localhost:8080/api/places -H "Authorization: Bearer <token>"
```

Usuarios semilla válidos: `u1`–`u6` (rol `cliente`), `b1`, `b2`, `b3` (rol `negocio`) — deben coincidir siempre con `DEMO_USERS` en `planazo-frontend/frontend/src/lib/session.ts`.

---

## Variables de entorno

Ver [`.env.example`](.env.example). En producción (Railway):

- `JWT_SECRET`: genera uno largo, no reutilices el de desarrollo.
- `BOOKING_URL` / `PROMO_URL` / `GAME_URL`: la URL pública que Railway le da a cada servicio cuando lo despliegues.
- `ANTHROPIC_API_KEY`: opcional. Sin ella, `/api/plan` responde con una plantilla simple en vez de llamar al modelo (así no bloquea a nadie mientras la consigues).

---

## Desplegar en Railway

1. En Railway: **New Project → Deploy from GitHub repo** → elige `planazo-team/planazo-api-gateway`.
2. En la pestaña **Variables** del servicio, agrega las mismas variables de `.env.example` (menos `PORT`, Railway lo asigna solo).
3. Railway detecta Node y corre `npm install && npm run build && npm start` automáticamente (usa `package.json`).
4. Copia la URL pública que te da Railway — es el `NEXT_PUBLIC_API_URL` que necesita el frontend.

Actualiza `BOOKING_URL`, `PROMO_URL` y `GAME_URL` a medida que tus compañeros desplieguen sus servicios — mientras tanto el gateway sigue funcionando, solo responde `502` en esas rutas.
