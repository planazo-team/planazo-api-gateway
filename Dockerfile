# ── Etapa 1: compilar ────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── Etapa 2: imagen final, solo lo necesario para correr ─────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
USER node
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${PORT:-8080}/api/health || exit 1
CMD ["node", "dist/main.js"]
