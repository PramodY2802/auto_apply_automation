# Architecture

## Components

```
            ┌────────────┐   same-origin /api proxy   ┌──────────────┐
 Browser ──▶│ apps/web   │ ──────────────────────────▶│  apps/api    │──┐
            │ Next.js    │                            │  NestJS REST │  │ enqueue (BullMQ)
            └────────────┘                            └──────┬───────┘  ▼
 Extension ─────────── Bearer aa_pat_… (scope: extension) ───┘   ┌──────────────┐
                                                                  │    Redis     │
                       ┌──────────────── PostgreSQL ◀────────────┤  queues      │
                       │                                          └──────┬───────┘
                       │        ┌─────────────────────────────────────────┴──────────────┐
                       └────────┤ workers (one image, split by WORKER_QUEUES)            │
                                │  document-processing → OCR + AI extraction             │
                                │  job-discovery / job-matching                          │
                                │  application-preparation / -submission → Playwright    │
                                │  application-sync, notifications, billing, scheduler   │
                                └───────┬───────────────────────┬────────────────────────┘
                                        ▼                       ▼
                         AI providers (OpenAI/Anthropic/     Job sources (Sandbox board,
                         Gemini) via provider router         Greenhouse/Lever public APIs)
            Object storage: S3-compatible (MinIO/S3/R2) or local filesystem in development
```

### Packages (framework-agnostic, unit-tested)

| Package | Responsibility |
|---|---|
| `shared` | Enums, status-transition rules, zod schemas (API + AI output contracts), skill taxonomy, text normalization, RBAC definition |
| `database` | Drizzle schema for all entities, SQL migrations, seed (roles/permissions, plans, AI provider catalog, settings), DB reset helper |
| `document-extraction` | `DocumentUploadService`, `DocumentTypeDetector`, `PDFTextExtractor`, `PdfRasterizer`, `DOCXExtractor`, `ImagePreprocessor`, `OCRService` (Tesseract CLI, Google Vision), `HeuristicResumeParser`, `ResumeAIParser`, `StructuredDataValidator`, `CandidateProfileMapper`, and the generic `DocumentTextPipeline` plus `ResumeExtractionPipeline` |
| `ai-providers` | `AIProviderInterface`, `OpenAIAdapter`, `AnthropicAdapter`, `GeminiAdapter`, `MockAIAdapter`, `AIProviderRegistry`, `AIProviderRouter` (precedence, same-scope fallback, limits, structured output + repair), `AICostCalculator`, `AIUsageTracker` |
| `answer-engine` | Question intent classification and `AnswerEngine` (saved answers → profile facts → grounded AI), unsupported-claim detection, cover letters |
| `matching-engine` | Job enrichment (skills split into required/optional, experience, salary, work mode), fingerprinting, fuzzy dedupe, deterministic `MatchingEngine` |
| `platform-integrations` | Common adapter interface (`authenticate … disconnect`), adapters, capability matrix, JSON-LD normalizer, query builder, `BrowserFormDriver` port |
| `services` | Domain services used by both API and workers: AI config source/facade, profiles, document processing, job ingest, matching, discovery, the application orchestrator, usage limits, billing and payment providers, notifications, audit, settings, storage, encryption, queues, structured logging |

API controllers stay thin: they handle authentication, RBAC, validation and HTTP concerns, and delegate everything else to `services`. Workers are pure BullMQ processors over the same services (`workers/src/processors.ts`).

## Key flows

**Resume → profile.** Upload is validated by magic bytes, size and an extension/content match check, hashed, and stored. An extraction row is created and a `document-processing` job is queued. The worker detects the type. For PDFs it uses each page's text layer when there is one; pages without one are rasterized at 300 dpi and preprocessed: orientation correction via Tesseract OSD, grayscale, upscaling, contrast normalization, median denoise, projection-profile deskew, and binarization if confidence is low. They are then OCR'd from Tesseract TSV, which keeps the layout. The text goes to the AI parser when a provider is configured; otherwise the deterministic parser is used. Either way, the `StructuredDataValidator` enforces the schema and **grounding**: ungrounded employers, education, certifications and skills are removed, ungrounded identity fields are nulled, and total experience is recomputed from dates. Confidences are reduced when OCR quality is low. An unreviewed profile is prefilled, and the user confirms it on the review screen.

**Discovery.** For each title × location query built from the preferences, every adapter whose `searchJobs` is implemented is called. Unsupported platforms are logged as skipped, with the reason. Jobs are normalized and enriched, then deduplicated in three ways: (platform, externalId), a fingerprint of company + title + city, and fuzzy title/description shingles within the same company. They are stored as one logical `jobs` row with many `job_sources`, then scored for the user. Runs record stats and logs, and scheduled runs come from `nextSearchAt`.

**Application.** The steps are: create (duplicate check, excluded companies, plan limit, resume choice, preferring a source that supports automated submission) → `application-preparation` (form detection via the adapter: Playwright for the sandbox, the public questions API for Greenhouse; then answers for every field) → `PENDING_APPROVAL` (manual mode, or anything uncertain or sensitive) → explicit approval (sensitive declarations need a separate confirmation) → `application-submission`. Submission takes an atomic DB lock and is never auto-retried. It fills, then validates natively, then submits, then waits for the confirmation element and extracts the reference. It saves a screenshot as evidence, and only then sets `APPLIED`. "Submitted but no confirmation" → `NEEDS_VERIFICATION`. A CAPTCHA or a validation error → `FAILED`, with a notification. Every change writes `application_status_history` and `application_events`, and both tables are append-only (enforced by a DB trigger).

**AI routing.** Configs are resolved in order: USER (if the plan allows BYO and the enterprise permits it) → ENTERPRISE → PLATFORM (unless the enterprise disables platform AI). Within a scope, the `is_active` config is the primary. Fallback happens only when enabled and only to configs in the **same scope and owner**, so a request is never moved onto someone else's credentials. Each call is logged in `ai_usage_logs` with tokens, cost, latency and status, but never the prompt content. Platform-scope tokens count toward the plan's AI allowance and are invoiced separately with the plan's markup.

## Queues

| Queue | Attempts / backoff | Notes |
|---|---|---|
| document-processing | 3, exp 5s | permanent errors (corrupt, unsupported) are not retried |
| job-discovery | 3, exp 30s | runs are idempotent (status check) |
| job-matching | 3 | |
| application-preparation | 2 | |
| application-submission | **1** | never retried automatically, to avoid duplicate submissions; DB lock + `submittedAt` guard |
| application-sync | 3, exp 60s | |
| notifications | 5 | idempotent via `emailed_at` |
| billing | 5 | renewals hourly; AI invoices on the 1st (idempotent) |
| scheduler | 1 | repeatable: scheduled discovery (5 min), auto-apply (15 min), sync-all (1 h) |
| dead-letter | — | jobs that exhausted their attempts are copied here (visible in Admin → Queues) |

Idempotency keys (BullMQ job IDs), per-queue concurrency, lock durations, worker heartbeats (`autoapply:worker:*`) and graceful shutdown are all implemented in `workers/src`.

## Tenancy & RBAC

- Every user-owned row carries `user_id`. Enterprise-reportable rows also carry `enterprise_id`, and every query filters by the caller's server-side identity, never by IDs supplied in the request. Cross-tenant reads return 404.
- Jobs are public postings stored once; a user's access to a job goes through `job_matches` (user, job).
- Roles: `USER`, `PLATFORM_ADMIN`, `SUPER_ADMIN` (platform) and `ENTERPRISE_USER`, `ENTERPRISE_ADMIN` (membership). The role → permission mapping is seeded into `roles`/`permissions`/`role_permissions` and loaded by the API, which checks it with `@RequirePermissions`.
- A user belongs to at most one enterprise. Enterprise members inherit the enterprise subscription.

## Technology decisions

| Decision | Reason |
|---|---|
| **Drizzle ORM instead of Prisma** | Prisma's migration engine is a native binary downloaded at install time, and the build environment couldn't fetch it (HTTP 403), so migrations couldn't have been verified. Drizzle is pure TypeScript: the migrations in `packages/database/migrations` were generated, applied and exercised by every integration/E2E run. |
| Tesseract CLI + poppler instead of tesseract.js/pdf.js | Native speed, layout via TSV, OSD for orientation, mature PDF text extraction; both are packaged in the worker image. |
| sharp + custom projection-profile deskew instead of OpenCV | Keeps the pipeline in Node with no native OpenCV bindings; deskew/denoise/contrast/rotation are covered (and tested). |
| One Next.js app with role-aware sections instead of separate `admin`/`enterprise` apps | Shares auth/session and components; access is enforced server-side regardless of UI. |
| Hand-written accessible UI components instead of the shadcn CLI | The CLI fetches from a registry that was unreachable; the components follow the same patterns (Tailwind, focus rings, labels). |
| Domain logic in `packages/services` | The API and workers share one implementation of every business rule. |
