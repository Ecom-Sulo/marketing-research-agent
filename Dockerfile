# --- stage 1: build the SPA -------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- stage 2: build the server ----------------------------------------------
# Separate from the runtime stage so devDependencies (typescript, vitest) and
# the build toolchain for better-sqlite3 never reach the final image.
FROM node:22-alpine AS server
WORKDIR /build
# better-sqlite3 ships prebuilds for glibc, not musl, so alpine builds it from
# source. Without these it fails partway through `npm ci` with a node-gyp error
# that does not mention the missing compiler.
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npx tsc -p tsconfig.json

# Reinstall production-only, so node_modules carries no build tooling. The
# native better-sqlite3 binding compiled above is kept by the same command.
RUN npm ci --omit=dev

# --- stage 3: runtime -------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=server /build/node_modules ./node_modules
COPY --from=server /build/dist ./dist
COPY --from=server /build/package.json ./
COPY --from=frontend /build/dist ./static

# Both mount points must exist *in the image*, owned by the runtime user. Docker
# seeds an empty named volume from the image directory it is mounted over,
# ownership included — but only if that directory exists. Leave /corpus out and
# the volume comes up root-owned, every web_fetch fails to archive with EACCES,
# and every source in every packet reads `archived: false`. That shipped this
# way once and was caught by the preflight in deploy/vps/deploy.sh.
RUN addgroup -g 10002 appuser \
 && adduser -D -u 10002 -G appuser appuser \
 && mkdir -p /data /corpus && chown appuser:appuser /data /corpus
USER appuser
VOLUME ["/data", "/corpus"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
