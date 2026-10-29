# base → deps → builder → runner. Le runner ne contient que le serveur Nitro construit, le
# runner de migrations, le seed et leurs données : ni les sources ni les dépendances de build.

FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/scoring/package.json packages/scoring/
# Sans scripts : le postinstall (`nuxt prepare`) a besoin des sources, `nuxt build` le refait.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS builder
COPY . .
# NODE_ENV=production au build : nuxt.config.ts n'ajoute HSTS et la CSP qu'à cette condition.
RUN NODE_ENV=production pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7000
RUN groupadd --gid 1001 nodejs && useradd --uid 1001 --gid nodejs --no-create-home nodejs

COPY --from=builder --chown=nodejs:nodejs /app/.output ./.output
# Les modules tracés par Nitro (dont pg) servent aussi au runner de migrations et au seed.
COPY --from=builder --chown=nodejs:nodejs /app/.output/server/node_modules ./node_modules
COPY --chown=nodejs:nodejs package.json ./
COPY --chown=nodejs:nodejs supabase/migrations ./supabase/migrations
COPY --chown=nodejs:nodejs packages/scoring/src/versions ./packages/scoring/src/versions
COPY --chown=nodejs:nodejs scripts/migrate.mjs scripts/seed-scoring-version.ts ./scripts/
COPY --chown=nodejs:nodejs --chmod=755 docker-entrypoint.sh ./

USER nodejs
EXPOSE 7000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
