# planazo-api-gateway

Único punto de entrada HTTP de Planazo. Hace el inicio de sesión con Google y firma el JWT de Planazo, lo valida en cada petición, aplica un límite de peticiones por IP, y reenvía cada ruta al microservicio dueño. `agent` vive aquí dentro como un módulo — no tiene repo propio.

| | |
|---|---|
| **Dueño** | Juan Diego Melo |
| **Retos** | ninguno propio — es infraestructura |
| **Datos** | ninguno (sin base de datos, por diseño) |
| **Producción** | `https://planazo-api-gateway-production.up.railway.app` (Railway, dominio público) |
| **Contexto general** | [planazo-frontend/docs/contexto.md](https://github.com/planazo-team/planazo-frontend/blob/main/docs/contexto.md) |
| **Especificación** | [planazo-frontend/docs/arquitectura.md](https://github.com/planazo-team/planazo-frontend/blob/main/docs/arquitectura.md) |

**No tiene base de datos ni lógica de negocio propia**, salvo verificar el login con Google, firmar el JWT y armar el plan del agente.

---

## Rutas

| Ruta | Va a | Auth |
|---|---|---|
| `POST /api/auth/google` | el propio gateway: verifica el ID token de Google, booking guarda la cuenta y firma el JWT. `modo: "negocio"` solo si la cuenta registró su negocio (si no, `409 NEGOCIO_NO_REGISTRADO`) | pública |
| `POST /api/auth/negocio/registro` | el propio gateway: activa el modo negocio. Pide un token de Google de menos de 10 minutos; booking valida razón social, NIT con dígito de verificación, teléfono y términos, y que el NIT no esté en otra cuenta | pública (con Google) |
| `POST /api/auth/modo` | el propio gateway: cambia entre modo cliente y negocio (negocio solo si la cuenta lo tiene activado) | requiere token |
| `POST /api/auth/demo` | el propio gateway: usuarios semilla (`u1`…`b3`) o de prueba (`qa-…`) para k6 y las pruebas automáticas. Solo existe si `DEMO_LOGIN_KEY` está definida, y la pide en `x-demo-key` | llave |
| `GET/POST/PATCH /api/places*` | `booking` | requiere token |
| `* /api/reservations*` | `booking` | requiere token |
| `* /api/events*` | `booking` | requiere token |
| `* /api/promos*` | `promo` | requiere token |
| `* /api/salas*` · `/api/leaderboard*` · `/api/historico*` | `game` (Java), como `/api/v1/...` **y con el `Authorization: Bearer` reenviado**: game valida el JWT por su cuenta | requiere token |
| `* /api/rooms*` | `game` (ruta del diseño anterior; game no la implementa) | requiere token |
| `POST /api/plan` | módulo `agent` (interno) | requiere token |
| `GET /api/auth/me` | el propio gateway | requiere token |

`realtime` **no pasa por aquí**: el frontend se conecta a su WebSocket directamente (`NEXT_PUBLIC_REALTIME_URL`). Tampoco el STOMP de `game` (`NEXT_PUBLIC_GAME_URL`). Booking y promo reciben solo `x-user-*` y `x-gateway-key`, nunca el token; game recibe el token porque lo valida él (lee los claims `sub` y `nombre`, por eso el JWT lleva `nombre` además de `name`).

---

## Correr en local

```bash
npm install
cp .env.example .env
npm run start:dev
```

Levanta en `http://localhost:8080`. Sin `BOOKING_URL`/`PROMO_URL`/`GAME_URL` configurados apunta a `localhost:3001/3002/3003`; game (Java) corre en `8082`, así que en local conviene `GAME_URL=http://localhost:8082`. Si un servicio no está corriendo, el gateway responde `502` controlado (no se cae).

### Probar sin nada más levantado

```bash
# login de un usuario semilla (con DEMO_LOGIN_KEY=algo en el .env)
curl -X POST http://localhost:8080/api/auth/demo -H "Content-Type: application/json" -H "x-demo-key: algo" -d '{"userId":"u1"}'
# → { "token": "..." }

# usar el token en una ruta protegida
curl http://localhost:8080/api/places -H "Authorization: Bearer <token>"
```

Usuarios semilla válidos: `u1`–`u6` (rol `cliente`), `b1`, `b2`, `b3` (rol `negocio`) — deben coincidir siempre con `DEMO_USERS` en `planazo-frontend/frontend/src/lib/session.ts`.

---

## Variables de entorno

Ver [`.env.example`](.env.example). En producción (Railway):

- `JWT_SECRET`: 32 caracteres o más; el **mismo valor** en `realtime` (`JWT_SECRET`) y en `game` (`JWT_SECRETO`).
- `GOOGLE_CLIENT_ID`: el client ID de OAuth de Google (el mismo `NEXT_PUBLIC_GOOGLE_CLIENT_ID` del frontend). Sin él no se puede entrar.
- `DEMO_LOGIN_KEY`: opcional. Solo si se van a correr k6 o las pruebas automáticas contra este entorno.
- `BOOKING_URL` / `PROMO_URL` / `GAME_URL`: la URL **privada** de cada servicio (`http://planazo-booking.railway.internal:3001`, `http://planazo-promo.railway.internal:3002`, `http://planazo-game.railway.internal:8082`). Booking y promo no tienen dominio público.
- `ALLOWED_ORIGINS`: `https://planazo-frontend.vercel.app,http://localhost:3000`. `RATE_LIMIT_PER_MINUTE=600` en producción.
- `ANTHROPIC_API_KEY`: opcional. Sin ella, `/api/plan` responde con una plantilla simple en vez de llamar al modelo (así no bloquea a nadie mientras la consigues).

---

## Desplegar en Railway

Ya está desplegado: `planazo-infra/scripts/railway-deploy-core.sh` crea este servicio junto con booking y promo, desde GitHub (rama `main`, builder Dockerfile, health check en `/api/health`) y con todas las variables de arriba. Cada push a `main` redespliega.

Para repetirlo o cambiar variables:

```bash
railway link --project <id-del-proyecto> --environment production
JWT_SECRET=... GATEWAY_KEY=... bash ../planazo-infra/scripts/railway-deploy-core.sh
```

La URL pública del gateway es el `NEXT_PUBLIC_API_URL` del frontend en Vercel.
