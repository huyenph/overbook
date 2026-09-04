# ---------- base ----------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TZ=UTC
RUN corepack enable && apk add --no-cache tini curl
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
# pnpm-workspace.yaml carries the postinstall allowlist; without it pnpm
# refuses the install for having skipped a build script.
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --no-frozen-lockfile

# ---------- dev (hot reload, source is bind-mounted by compose) ----------
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "run", "start:dev"]

# ---------- build ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build && pnpm prune --prod

# ---------- prod ----------
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
# tini forwards SIGTERM to node so graceful shutdown (M8) actually runs.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
