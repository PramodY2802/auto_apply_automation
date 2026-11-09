# AutoApply

A multi-tenant SaaS platform for AI-assisted job search. Candidates upload a resume, and OCR + AI turn it into a profile they can verify. The platform then discovers jobs from authorized sources, ranks them with an explainable match score, drafts truthful application answers with the AI provider the account has configured, submits supported applications through browser automation once a confirmation can be verified, and tracks every application in one dashboard. Individuals, enterprise teams and a Super Admin panel are all supported.

> **Honesty principles built into the code:** nothing is invented from a resume (every extracted value is grounded against the source text), there are no generic application answers (answers come from the verified profile, otherwise the question is marked as needing the user's input), sensitive or legal declarations always require explicit confirmation, an application becomes `APPLIED` only after a confirmation is observed or the user confirms it, CAPTCHA/MFA/anti-bot measures are never bypassed, and each integration's capabilities are labelled exactly as they are.

## What's in the box

| Area | Where | Status |
|---|---|---|
| REST API (NestJS, versioned `/api/v1`, Swagger at `/api/docs`) | `apps/api` | Implemented + tested |
| Web app: user dashboard, onboarding, jobs, tracker, settings, enterprise panel, admin panel (Next.js) | `apps/web` | Implemented + browser-tested |
| Background workers (BullMQ): OCR/extraction, discovery, matching, application prep/submit (Playwright), sync, notifications, billing, scheduler | `workers` | Implemented + E2E-tested |
| Resume OCR & extraction pipeline | `packages/document-extraction` | Implemented + tested on real PDFs/DOCX/scans |
| AI provider layer (OpenAI, Anthropic, Gemini, router, cost, usage) | `packages/ai-providers` | Implemented; live calls need API keys |
| Question-answering engine | `packages/answer-engine` | Implemented + tested |
| Matching, normalization, dedupe | `packages/matching-engine` | Implemented + tested |
| Platform adapters (Sandbox, Greenhouse, Lever, LinkedIn, Indeed, Naukri) | `packages/platform-integrations` | See [capability matrix](docs/integrations.md) |
| Domain services shared by API and workers | `packages/services` | Implemented |
| Database schema + migrations (Drizzle/Postgres) | `packages/database` | Implemented |
| Browser extension (Chrome MV3) | `extension` | Implemented; content script browser-tested |
| Controlled test job board | `apps/sandbox-board` | Implemented |
| Docker / Compose / CI | `infrastructure/docker`, `docker-compose.yml`, `.github/workflows` | Written; **not built here** (no Docker daemon in the build environment) |

## Quick start (local, without Docker)

Requirements: Node 22+, pnpm 10, PostgreSQL 14+, Redis 6+, `tesseract-ocr` (with `eng` + `osd`), `poppler-utils`, Chromium for Playwright.

```bash
pnpm install
cp .env.example .env            # then set ENCRYPTION_KEYS (see the file) and DATABASE_URL
set -a && . ./.env && set +a
createdb autoapply
pnpm build                      # packages, API, workers, sandbox
pnpm db:migrate && pnpm db:seed
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='Choose-a-strong-1' pnpm --filter @autoapply/api create-admin
pnpm --filter @autoapply/workers exec playwright install chromium   # once

# four terminals (or a process manager):
pnpm dev:sandbox                # test job board  :4100
pnpm --filter @autoapply/api start   # API  :4000  (docs: /api/docs)
pnpm --filter @autoapply/workers start
pnpm dev:web                    # web app :3000
```

Open http://localhost:3000, sign up, upload a resume, set preferences with the **Sandbox** platform selected, and choose **Find jobs now**. To get AI-written answers and AI resume parsing, sign in as the Super Admin and add a provider key under **Admin → AI providers**. Without a key the platform still runs: it uses the deterministic parser, and free-text questions are marked as needing your input.

### With Docker

```bash
cp .env.example .env && echo "ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)" >> .env
docker compose up -d --build
docker compose exec api node apps/api/dist/cli/create-admin.js   # with ADMIN_EMAIL/ADMIN_PASSWORD env
```

## Tests

```bash
createdb autoapply_test && createdb autoapply_e2e
pnpm test:unit          # shared, ai-providers, document-extraction (real OCR), matching, integrations, answer-engine
pnpm test:integration   # API: auth, RBAC, tenant isolation, secrets, enterprise, billing, limits, rate limiting
pnpm --filter @autoapply/workers test      # extension content script in a real browser
pnpm test:e2e           # full flow: API + workers + Postgres + Redis + OCR + Playwright + sandbox board
WEB_URL=http://localhost:3000 pnpm --filter @autoapply/workers exec vitest run test/ui   # UI walkthrough against a running stack
```

## Documentation

- [Architecture](docs/architecture.md): components, data flow, queues, tenancy, technology decisions
- [Setup guide](docs/setup.md) and [Deployment guide](docs/deployment.md)
- [API](docs/api.md) (OpenAPI document: [`docs/openapi.json`](docs/openapi.json))
- [Integrations & capability matrix](docs/integrations.md)
- [Security & privacy](docs/security.md)
- [Browser extension](docs/extension.md)
- [Build report & remaining work](docs/BUILD_REPORT.md)
