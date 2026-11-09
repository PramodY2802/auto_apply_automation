# Setup guide

## Prerequisites
- Node.js 22+, pnpm 10 (`corepack enable`)
- PostgreSQL 14+ and Redis 6+
- Workers: `tesseract-ocr` with `eng` + `osd` traineddata, `poppler-utils` (`pdftotext`, `pdfinfo`, `pdftoppm`), and Chromium for Playwright (`pnpm --filter @autoapply/workers exec playwright install --with-deps chromium`, or set `CHROMIUM_PATH`)

Ubuntu/Debian: `sudo apt-get install -y tesseract-ocr tesseract-ocr-eng tesseract-ocr-osd poppler-utils`

## Configure
```bash
pnpm install
cp .env.example .env
echo "ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)" >> .env   # or edit the empty line
```
All variables are documented in `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEYS`. **Back up `ENCRYPTION_KEYS`**: without it, stored AI keys and platform credentials can't be decrypted. To rotate, prepend a new key (`k2:new,k1:old`). New data is encrypted with the first key, and all listed keys can decrypt.

## Database
```bash
set -a && . ./.env && set +a
createdb autoapply
pnpm build
pnpm db:migrate     # applies packages/database/migrations
pnpm db:seed        # roles/permissions, plans, AI provider catalog, platform settings (idempotent)
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='Strong-pass-123' pnpm --filter @autoapply/api create-admin
```
Schema changes: edit `packages/database/src/schema.ts`, then run `pnpm db:generate` (drizzle-kit writes a new SQL migration) and commit it.

## Run
| Process | Command | Port |
|---|---|---|
| API | `pnpm --filter @autoapply/api start` | 4000 (`/api/docs` Swagger) |
| Workers | `pnpm --filter @autoapply/workers start` (all queues) or `WORKER_QUEUES=document-processing …` | — |
| Web | `pnpm dev:web` (dev) or `pnpm build:web && node apps/web/.next/standalone/apps/web/server.js` | 3000 |
| Sandbox board (test only) | `pnpm dev:sandbox` | 4100 |

The web app proxies `/api/*` to `API_INTERNAL_URL` (default `http://localhost:4000`), so cookies are first-party. Note: Next.js bakes rewrites in at **build** time, so set `API_INTERNAL_URL` before `pnpm build:web`.

## First use
1. Sign in as the Super Admin → **Admin → AI providers** → add an OpenAI, Anthropic or Gemini key (stored encrypted) and choose models. Check the model prices in the catalog against each provider's current pricing.
2. Sign up as a candidate → onboarding → upload a resume → review the profile → set preferences (include **Sandbox**) → **Save & find jobs**.
3. Open a job → **Prepare application** → review the answers → approve → watch it submit to the sandbox board and become *Applied* with a verified reference.

Without an AI key, extraction uses the deterministic parser and free-text questions are marked as needing your input. Nothing is guessed.

## Emails in development
With `SMTP_URL` unset, emails go to the log. Set `MAIL_LOG_BODIES=true` to see verification and reset links locally.

## Tests
```bash
createdb autoapply_test && createdb autoapply_e2e
pnpm build
pnpm test:unit && pnpm test:integration && pnpm --filter @autoapply/workers test && pnpm test:e2e
```
The tests use Redis DBs 4 and 5 and override the database URLs via `TEST_DATABASE_URL` / `E2E_DATABASE_URL`.
