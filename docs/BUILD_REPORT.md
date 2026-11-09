# Build report

## Summary
A new, independent monorepo (TypeScript throughout) implementing the AutoApply platform: NestJS API, Next.js web app (user, enterprise and admin areas), BullMQ workers including Playwright browser automation, a resume OCR and extraction engine, a multi-provider AI layer, the question-answering engine, deterministic matching, platform adapters with an honest capability matrix, multi-tenant enterprise management, subscriptions and billing, notifications, a Chrome MV3 extension, and a controlled sandbox job board for safe end-to-end testing.

## What was implemented
| Spec section | Result |
|---|---|
| 1–3 Vision, stack, structure | Monorepo: `apps/{api,web,sandbox-board}`, `workers`, `packages/{shared,database,ai-providers,document-extraction,matching-engine,platform-integrations,answer-engine,services}`, `extension`, `infrastructure`, `docs`. Deviations are listed in [architecture.md § decisions](architecture.md#technology-decisions) |
| 4 Auth & accounts | Signup (individual/enterprise/invitation), login with lockout, logout, email verification, password reset/change, session management (list/revoke), account settings, secure cookies, CSRF, RBAC with 5 roles, enterprise invitations and memberships, tenant isolation |
| 5 OCR & extraction | Validation → magic-byte type detection → native PDF text per page / DOCX / rasterize + preprocess (orientation via OSD, grayscale, resize, contrast, denoise, deskew, binarize fallback) + Tesseract OCR with layout → AI structured extraction (or deterministic parser) → strict schema + grounding validation (nothing invented) → stored with page references, per-field confidence, warnings and a step log → editable review screen. OCR is reusable (`DocumentTextPipeline`), engines are configurable (Tesseract, Google Vision) |
| 6 Onboarding | 9-step wizard (upload, extraction, review, roles, experience bands/custom, locations + work modes, salary, more preferences + declarations + application mode, save); everything editable later |
| 7 Platform adapters | Common interface; Sandbox (fully automated), Greenhouse and Lever (public APIs), LinkedIn/Indeed/Naukri (user-assisted, honest `UNSUPPORTED` search); see [integrations.md](integrations.md) |
| 8 Discovery | Query generation from preferences, background runs (manual + scheduled with frequency), normalization, three-layer dedupe, one logical job with many sources, run history with stats and logs, notifications |
| 9 Matching | Deterministic, configurable weights (admin setting); overall/skill/experience/location/preference/salary scores, matched/missing skills, explanation, disqualifiers; explicitly not a hiring probability |
| 10 Dashboard | All 13 views with counts, search, platform/score filters, sorting, pagination, bulk actions (prepare applications, save, mark seen, hide), job detail with match breakdown, sources and application history |
| 11 AI providers | OpenAI/Anthropic/Gemini adapters, registry, router (USER → ENTERPRISE → PLATFORM, same-scope fallback only), per-task models, encrypted keys, health checks, monthly token limits, usage logs, cost calculation, structured JSON with schema validation and repair |
| 12 Question answering | Intent detection (27 intents incl. legal/demographic), saved answers → profile/preference facts → grounded AI; never fabricates; unknown → requires input; sensitive → explicit confirmation; unsupported-claim detection; edit/approve/reuse; versioned answer history |
| 13 Browser automation | Playwright driver: isolated contexts, semaphore concurrency, timeouts, navigation retry, crash relaunch, guaranteed cleanup, form detection with label resolution, filling (text/select/radio/checkbox/file), native validation check, confirmation verification, screenshot evidence, CAPTCHA stop, host allow-list, execution logs |
| 14 Auto-apply | The full 19-step workflow incl. duplicate prevention (DB unique + atomic lock), manual mode, automatic mode with consent, score threshold and daily limit (scheduler), approvals for uncertain/sensitive answers |
| 15 Tracking | All 13 statuses with a transition table, INTERNAL/EXTERNAL sources, confirmation evidence, sync via authorized integrations, NEEDS_VERIFICATION/UNKNOWN handling, append-only events + status history (DB triggers), never false APPLIED |
| 16 Extension | MV3: capture job (JSON-LD), fill approved answers, report submission, platform session status; minimal permissions; scoped token; docs |
| 17 Enterprise | Super Admin / Platform Admin / Enterprise Admin / Enterprise User / Individual capabilities; teams, invitations, roles, enterprise AI config & policy, usage, analytics, audit |
| 18 Billing | Free/Basic/Pro/Enterprise/Custom plans (configurable), monthly/annual, limits (users, searches, applications, AI tokens, storage, browser minutes¹) and feature flags, usage records, upgrades (immediate), downgrades (at period end), cancellation, renewals, invoices, AI consumption invoiced separately with markup, payment provider abstraction (manual + Stripe) |
| 19–21 Panels | Super Admin (metrics, users, enterprises, plans, billing, AI providers/pricing/platform configs, integrations, queues/workers/DLQ, audit, settings), Enterprise panel, User dashboard |
| 22 Workers | Independent queues/processes for every listed responsibility; retries, backoff, idempotency keys, DLQ, locks, concurrency, cancellation (discovery), heartbeats, structured logs |
| 23 Database | 39 tables with FKs, indexes, unique and check constraints, soft deletion for resumes/users/enterprises, append-only triggers |
| 24 Security | See [security.md](security.md) |
| 25 UI | Consistent design system, responsive layout with mobile nav, role-aware navigation, loading/empty/error states, confirmation dialogs, tables, charts, toasts; all data from real APIs |

¹ The browser-minutes limit is defined and displayed, but usage is not yet metered (see remaining work).

## What was tested (all passing)
| Suite | Tests | Covers |
|---|---|---|
| `packages/shared` | 11 | transitions, skill taxonomy, normalization, redaction, schemas |
| `packages/ai-providers` | 13 | request shapes and auth for all 3 providers (mocked HTTP), error mapping, precedence, per-task models, no cross-scope fallback, token limits, structured repair, cost |
| `packages/document-extraction` | 17 | real text PDF, DOCX, **skewed noisy scanned PDF (OCR)**, **90°-rotated PNG (OSD)**, upload validation, Tesseract TSV parsing, grounding (removes invented employers/certs/skills/summaries), AI path, AI-failure fallback, deskew accuracy |
| `packages/matching-engine` | 12 | scoring, determinism, disqualifiers, weights, salary/experience parsing, skill split, fingerprint + fuzzy dedupe |
| `packages/platform-integrations` | 12 | capability honesty, Greenhouse/Lever against recorded responses, sandbox adapter, JSON-LD normalization, query builder |
| `packages/answer-engine` | 24 | intent classification, profile answers, option mapping, no guessing, sensitive/legal handling, saved answers, AI grounding and claim checks, URL normalization |
| `apps/api` integration + security | 29 | auth flows, lockout, CSRF, hashed sessions, reset revocation, uploads, preferences gating, **cross-tenant isolation**, **RBAC / role escalation**, **secret exposure**, BYO plan gating, enterprise invite/isolation/teams, billing upgrade/downgrade/renewal, AI usage invoicing, plan limits, platforms, health, OpenAPI, account deletion, rate limiting |
| `workers` unit | 2 | extension content script in Chromium (JSON-LD capture, approved-only fill) |
| `workers` E2E | 10 | full flow with real Postgres + Redis/BullMQ + OCR + Playwright + sandbox: AI extraction with grounding, OCR upload, discovery (LinkedIn honestly skipped), matching, answer preparation, approval gates, **verified submission → APPLIED**, evidence screenshot, immutable history, **external status sync**, **CAPTCHA stop**, notifications, AI usage, extension token scope + capture |
| `workers` UI walkthrough | 4 | the real web UI in a browser: signup → onboarding → upload → review → preferences → discovery → jobs → job detail → application review; dashboard, platforms, billing, admin |

**Total: 134 automated tests.** External providers are mocked (scripted AI provider, recorded board responses). No application was ever submitted to a real job portal.

## Build results
- `pnpm build`: all 8 packages, the API, the workers and the sandbox compile with `strict` TypeScript.
- `pnpm build:web`: Next.js 16 production build with type-check, 19 routes.
- Migrations `0000_init` and `0001_immutable_history` are generated by drizzle-kit and applied on fresh databases by every test run.
- OpenAPI: 98 paths (`docs/openapi.json`).
- **Not verified:** Docker image builds and `docker compose up` (no Docker daemon in the build environment), the GitHub Actions workflow, live calls to OpenAI/Anthropic/Gemini/Greenhouse/Lever/Google Vision/Stripe.

## Database changes
New schema (migration `0000_init`): users, sessions, auth_tokens, api_tokens, enterprises, teams, enterprise_members, enterprise_invitations, roles, permissions, role_permissions, resumes, resume_extractions, candidate_profiles, candidate_experiences, candidate_education, candidate_skills, candidate_preferences, platform_connections, browser_sessions, jobs, job_sources, job_discovery_runs, job_matches, applications, application_answers, saved_answers, application_events, application_status_history, ai_providers, ai_provider_configs, ai_usage_logs, plans, subscriptions, usage_records, invoices, notifications, audit_logs, platform_settings, plus 30 Postgres enums. Migration `0001` adds append-only triggers. The seed adds 19 permissions, 5 roles, 4 plans, the 4-provider AI catalog and 4 platform settings.

## Services created
API (`apps/api`), web (`apps/web`), workers (`workers`, 10 queues, split by `WORKER_QUEUES`), sandbox board (`apps/sandbox-board`), migrate job, browser extension.

## External credentials required
| For | Variable / place | Without it |
|---|---|---|
| AI (any of) | OpenAI / Anthropic / Gemini API key, entered in Admin → AI providers (or by users/enterprises) | deterministic resume parser; free-text answers need user input |
| Email | `SMTP_URL`, `MAIL_FROM` | emails are logged |
| Object storage | `S3_*` | local filesystem |
| Cloud OCR (optional) | `GOOGLE_VISION_API_KEY`, `OCR_ENGINE=google-vision` | Tesseract |
| Payments (optional) | `STRIPE_SECRET_KEY`, `PAYMENT_PROVIDER=stripe` | manual invoices |
| Encryption | `ENCRYPTION_KEYS` (**required**) | the app refuses to start |
| Greenhouse / Lever | none (public APIs); outbound network access | — |

## Platform restrictions
LinkedIn, Indeed and Naukri offer no public search or apply API and prohibit scraping, so search is `UNSUPPORTED` and authentication, capture, filling and submission are `USER_ASSISTED` through the extension. Greenhouse and Lever submissions need the employer's key, so they are user-assisted too. Automated submission is implemented end to end only for the sandbox board, and for any future adapter whose platform authorizes it. CAPTCHA, MFA and anti-bot measures are never bypassed.

## Remaining work
Highest value first:
1. **Verify the container builds and compose stack** in CI, and push the images.
2. **Live verification** of the AI adapters (OpenAI/Anthropic/Gemini) with real keys, and of the Greenhouse/Lever adapters with network access; tune the extraction prompts on a corpus of real resumes.
3. **Stripe webhooks** (`checkout.session.completed`, `invoice.paid`) for automatic settlement; proration on upgrades; seat-based enterprise pricing.
4. **Browser-minute metering**: record `BROWSER_MINUTES` usage from the driver's operation timings and enforce the plan limit.
5. **Defence in depth**: Postgres row-level security policies mirroring the app-level tenant checks; malware scanning of uploads (e.g. ClamAV sidecar); optional TOTP 2FA for AutoApply accounts.
6. **Retention jobs**: purge expired sessions/tokens, prune old AI usage logs and evidence screenshots according to policy.
7. **Encrypted browser sessions**: the `browser_sessions` table and the driver's `storageState` support are in place, but no flow captures sessions yet. They are needed only for future authorized platforms that require login automation.
8. **Resume selection per job / tailored resumes**, and a dedicated cover-letter step (`generateCoverLetter` exists but is not yet wired to the UI).
9. **Admin role/permission editor UI** (the mapping is DB-backed; editing today means SQL).
10. Job closure detection (`jobs.closed_at`), Slack/push notification channels, Firefox build of the extension, i18n, component-level UI tests, load testing.

## Exact commands to start the project
```bash
# prerequisites: Node 22, pnpm 10, Postgres, Redis, tesseract-ocr (+eng, osd), poppler-utils
pnpm install
cp .env.example .env && sed -i "s|^ENCRYPTION_KEYS=.*|ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)|" .env
set -a && . ./.env && set +a
createdb autoapply
pnpm build && pnpm build:web
pnpm db:migrate && pnpm db:seed
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='Strong-pass-123' pnpm --filter @autoapply/api create-admin
pnpm --filter @autoapply/workers exec playwright install chromium

node apps/sandbox-board/dist/main.js &            # :4100 test job board
node apps/api/dist/main.js &                      # :4000, docs at /api/docs
node workers/dist/main.js &                       # all queues
PORT=3000 node apps/web/.next/standalone/apps/web/server.js   # :3000 (or: pnpm dev:web)
# note: copy apps/web/.next/static into .next/standalone/apps/web/.next/ when running standalone outside Docker

# Docker alternative (unverified here):
docker compose up -d --build
```
