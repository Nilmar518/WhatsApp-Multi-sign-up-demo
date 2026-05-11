FROM node:20-alpine
WORKDIR /app

RUN npm install -g pnpm@9.15.4

# Workspace manifest files for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/backend/package.json ./apps/backend/

# Production deps only — ignore-scripts skips husky prepare
RUN pnpm install --prod --filter @migo-uit/backend --frozen-lockfile --ignore-scripts

# Pre-compiled dist (built in CI before docker build)
COPY apps/backend/dist ./apps/backend/dist

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs
USER nestjs

EXPOSE 8080
WORKDIR /app/apps/backend
CMD ["node", "dist/main.js"]
