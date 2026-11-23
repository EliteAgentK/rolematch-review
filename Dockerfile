# The RoleMatch image: the built website and the server, with production packages only. Settings and secrets come from the environment at run time, never from the image.
# One image runs every role: ROLE=api serves people, `src/worker.js` reads documents and sends mail, and WORKER_JOBS=model makes a worker take only language-model work.
# Builds for the machine it runs on, x86 or ARM. ROLEMATCH_COMMIT is the exact commit, so a running server can say what it is running.
FROM node:24-bookworm-slim AS website
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.mjs tsconfig.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
# The website shares a few pure functions with the server (one ranking rule), so it builds with the server's source beside it.
COPY server/src ./server/src
RUN npm run build

FROM node:24-bookworm-slim AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/scripts/buildServer.mjs ./scripts/buildServer.mjs
COPY server/src ./src
RUN node scripts/buildServer.mjs /app/built

FROM node:24-bookworm-slim AS server-packages
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
# Fonts: a PDF whose fonts are not embedded is drawn with these before OCR; with none, its text would be blank.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-liberation fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
ARG ROLEMATCH_COMMIT=unknown
ENV NODE_ENV=production COOKIE_SECURE=true TRUST_PROXY=true DATA_DIR=/data PORT=8787 ROLEMATCH_COMMIT=$ROLEMATCH_COMMIT
WORKDIR /app/server
COPY --from=server-packages /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY --from=server-build /app/built ./src
COPY supabase/migrations /app/supabase/migrations
COPY --from=website /app/dist /app/dist
# E-mails carry this logo (src/email.ts).
COPY public/logo-light.png /app/public/logo-light.png
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/index.js"]
