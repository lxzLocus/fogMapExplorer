# Single image: builds the frontend PWA, then runs the Node/Express server which
# serves both the API (/api) and the static PWA. Build context = repo root.

# ---- stage 1: build the frontend (Vite) ----
# Debian-slim (glibc) so sharp's prebuilt binaries install cleanly for icon gen.
FROM node:20-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- stage 2: runtime (Node serves API + static PWA) ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/ ./
# Built PWA -> served by Express from /app/public
COPY --from=frontend /fe/dist ./public

EXPOSE 3000
USER node

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/index.js"]
