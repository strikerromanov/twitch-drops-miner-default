# ─── Stage 1: Build frontend ─────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build
COPY package*.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src/ ./src/

RUN npm run build
# → produces /build/dist/

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server source + transpile via tsx (no separate tsc step needed for tsx)
COPY server.ts tsconfig*.json ./
COPY src/api     ./src/api/
COPY src/core    ./src/core/
COPY src/services ./src/services/

# Copy built frontend
COPY --from=frontend-builder /build/dist ./dist/

# Data directory (mounted as volume in docker-compose)
RUN mkdir -p /app/data && chown node:node /app/data

# Run as non-root
USER node

EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Use tsx to run TypeScript directly (no separate compile step)
CMD ["node", "--loader", "tsx/esm", "server.ts"]
