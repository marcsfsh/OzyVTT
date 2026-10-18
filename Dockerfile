# syntax=docker/dockerfile:1

# OzyVTT in one image: the server runs from source with tsx and serves the built client on port 3001.
# The campaign lives in /data; mount a volume there. README.md, "Hosting with Docker", has the commands.

# Build the client with every dependency installed.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund && npm run build

# The server's production dependencies alone, at the lockfile's versions. The root workspace list is narrowed to the
# server and the packages it runs, so the client's and the tests' dependencies stay out of the image.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/content-srd-5.2.1/package.json packages/content-srd-5.2.1/
COPY packages/domain/package.json packages/domain/
COPY packages/rules-5e/package.json packages/rules-5e/
COPY packages/schemas/package.json packages/schemas/
RUN --mount=type=cache,target=/root/.npm \
  npm pkg set 'workspaces[0]=apps/server' 'workspaces[1]=packages/*' && \
  npm pkg delete devDependencies && \
  npm install --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
  PORT=3001 \
  DATA_DIR=/data \
  OZYVTT_DOCKER=1
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY tsconfig.base.json tsconfig.node.json ./
COPY apps/server/package.json apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY apps/server/scripts apps/server/scripts
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/api-contract/src packages/api-contract/src
COPY packages/content-srd-5.2.1/package.json packages/content-srd-5.2.1/
COPY packages/content-srd-5.2.1/src packages/content-srd-5.2.1/src
COPY packages/content-srd-5.2.1/bundles packages/content-srd-5.2.1/bundles
COPY packages/domain/package.json packages/domain/
COPY packages/domain/src packages/domain/src
COPY packages/rules-5e/package.json packages/rules-5e/
COPY packages/rules-5e/src packages/rules-5e/src
COPY packages/schemas/package.json packages/schemas/
COPY packages/schemas/src packages/schemas/src
COPY --from=build /app/apps/client/dist apps/client/dist
# A named volume takes the owner of the directory it is mounted over, so the node user can write to it.
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3001
WORKDIR /app/apps/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/v1/host/setup`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--import", "tsx", "src/index.ts"]
