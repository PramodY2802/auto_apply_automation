# Deployment guide

## Topology
- **web** (Next.js standalone) behind HTTPS; proxies `/api` to **api**
- **api** (stateless; scale horizontally)
- **workers**: one image, deployed as separate services by `WORKER_QUEUES`:
  - `document-processing` (CPU-heavy OCR)
  - `job-discovery,job-matching`
  - `application-preparation,application-submission` (Chromium; give it ≥1 GB shm and memory; tune `BROWSER_MAX_CONCURRENCY`)
  - `application-sync,notifications,billing,scheduler` (exactly **one** replica includes `scheduler`)
- PostgreSQL (managed, PITR backups), Redis (persistence on; BullMQ needs `maxmemory-policy noeviction`), S3-compatible bucket (private, SSE)
- A **migrate** one-shot job before each release (`node packages/database/dist/migrate.js && node packages/database/dist/seed.js`)

`docker-compose.yml` shows this topology with MinIO. Images come from `infrastructure/docker/Dockerfile` (targets `api`, `workers`, `web`, `migrate`, `sandbox`). **The Docker build was not executed in the environment where this code was written (no Docker daemon available), so validate the images in your CI first.**

## Production configuration checklist
- `NODE_ENV=production`, `COOKIE_SECURE=true`, `COOKIE_DOMAIN` if the web app and API use different subdomains, `WEB_ORIGIN` set to the public web URL
- `ENCRYPTION_KEYS` from a secret manager (never in images)
- `REQUIRE_EMAIL_VERIFICATION=true`, `SMTP_URL`, `MAIL_FROM`
- `STORAGE_DRIVER=s3` and bucket credentials (use IAM roles where possible)
- `EXTENSION_ORIGINS=chrome-extension://<published-id>` (in production the API only accepts origins on this list)
- `BROWSER_ALLOWED_HOSTS` allow-list for the browser workers
- Remove the sandbox service and the `sandbox` platform from user-facing plans (or keep it for staging)
- Set `ai.allowMockProvider=false` (Admin → Platform settings); this is the default in production
- Rate limits: `RATE_LIMIT_PER_MINUTE` (global) plus per-route limits on auth endpoints; put a WAF/CDN in front of web/api
- Monitoring: `/api/v1/health` (liveness), `/api/v1/health/ready` (DB + Redis), Admin → Queues & workers (queue counts, heartbeats, dead letters); JSON logs on stdout with secrets/PII redacted

## Data retention
- Deleting a resume removes the stored file and its extracted text.
- Account deletion (`DELETE /api/v1/me`) removes files and personal data; only an anonymized audit entry is kept.
- `application_events` / `application_status_history` are append-only (DB triggers); they are deleted only together with their application.
- Suggested scheduled jobs (not yet automated): purge `sessions` and `auth_tokens` past expiry, and prune `ai_usage_logs` older than the retention period after invoicing.

## Payments
`PAYMENT_PROVIDER=manual` (default) issues invoices that admins mark paid. `stripe` uses the Stripe Checkout Sessions REST API and requires `STRIPE_SECRET_KEY`. It is implemented but **not verified against Stripe**. Webhooks for automatic settlement are listed in the remaining work.
