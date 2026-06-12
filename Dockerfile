# Multi-stage build for the Missile Wars shard backend.
# Build: compile TypeScript with tsconfig.server.json. Run: node dist/server.js.

FROM node:22-bookworm-slim AS build

# git: middle-earth is installed from GitHub. openssl: Prisma engines.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first so Docker layer-caches them. prisma/ must be present
# because the postinstall hook runs `prisma generate`.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx tsc --project tsconfig.server.json


FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# node_modules is kept whole (incl. the prisma CLI) so the one-shot migrate
# service in docker-compose can run `npx prisma db push` from this same image.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
# server.js serves static files from a `public` dir next to itself.
COPY --from=build /app/public ./dist/public

# sed strips CRLF in case the repo was checked out on Windows.
COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/server.js"]
