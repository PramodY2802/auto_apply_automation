# syntax=docker/dockerfile:1.7
# Multi-target image for the AutoApply monorepo.
#   docker build -f infrastructure/docker/Dockerfile --target api .
#   targets: api | workers | web | sandbox | migrate

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY workers workers
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Next.js bakes rewrites at build time: point the /api proxy at the API service.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm build && pnpm build:web

# ---------------------------------------------------------------- runtime base
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app -d /app app
WORKDIR /app

# ---------------------------------------------------------------- migrate (one-shot job)
FROM runtime AS migrate
COPY --from=build --chown=app:app /repo /app
USER app
CMD ["sh", "-c", "node packages/database/dist/migrate.js && node packages/database/dist/seed.js"]

# ---------------------------------------------------------------- api
FROM runtime AS api
COPY --from=build --chown=app:app /repo /app
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

# ---------------------------------------------------------------- workers (OCR + Playwright)
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS workers
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-osd poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /repo /app
USER pwuser
CMD ["node", "workers/dist/main.js"]

# ---------------------------------------------------------------- web (Next.js standalone)
FROM runtime AS web
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone /app
COPY --from=build --chown=app:app /repo/apps/web/.next/static /app/apps/web/.next/static
USER app
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------- sandbox job board (test environment only)
FROM runtime AS sandbox
COPY --from=build --chown=app:app /repo/apps/sandbox-board /app/apps/sandbox-board
COPY --from=build --chown=app:app /repo/node_modules /app/node_modules
USER app
EXPOSE 4100
CMD ["node", "apps/sandbox-board/dist/main.js"]
