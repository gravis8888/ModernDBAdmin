# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS build

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/backend apps/backend
COPY packages/shared packages/shared

RUN pnpm --filter @modern-db-admin/shared build
RUN pnpm --filter @modern-db-admin/backend build
RUN pnpm deploy --filter @modern-db-admin/backend --prod --legacy /prod/backend

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV SQLITE_DB_PATH=/var/lib/modern-db-admin/app.sqlite

RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p /var/lib/modern-db-admin && chown -R app:app /app /var/lib/modern-db-admin

COPY --from=build /prod/backend/ ./

USER app

EXPOSE 3001

CMD ["node", "dist/server.js"]
