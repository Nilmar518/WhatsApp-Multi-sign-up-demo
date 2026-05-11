FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9.15.4

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# Provide all workspace manifests so pnpm can resolve the monorepo graph
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

RUN pnpm install --filter @migo-uit/backend --frozen-lockfile --ignore-scripts

COPY apps/backend ./apps/backend

RUN pnpm --filter @migo-uit/backend build

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app

RUN npm install -g pnpm@9.15.4

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

RUN pnpm install --prod --filter @migo-uit/backend --frozen-lockfile --ignore-scripts

COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs
USER nestjs

EXPOSE 8080
WORKDIR /app/apps/backend
CMD ["node", "dist/main.js"]
