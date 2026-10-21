# node:22-alpine, pinned 2026-10-14 for reproducible multi-architecture builds.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts/build-preview.mjs ./scripts/build-preview.mjs
RUN npm run build

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY scripts/serve.mjs ./scripts/serve.mjs
COPY scripts/engine.mjs ./scripts/engine.mjs
COPY --from=build /app/node_modules/stockfish/bin/stockfish-19-lite-single.js ./node_modules/stockfish/bin/stockfish-19-lite-single.js
COPY --from=build /app/node_modules/stockfish/bin/stockfish-19-lite-single.wasm ./node_modules/stockfish/bin/stockfish-19-lite-single.wasm
RUN addgroup -S -g 10001 chesscoach \
 && adduser -S -D -H -u 10001 -G chesscoach chesscoach \
 && chown -R chesscoach:chesscoach /app
USER chesscoach
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/serve.mjs"]
