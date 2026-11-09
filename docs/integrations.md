# Integrations & capability matrix

Every adapter implements the common interface `authenticate, validateConnection, searchJobs, fetchJobDetails, normalizeJob, getApplicationForm, fillApplicationForm, submitApplication, checkApplicationStatus, disconnect` (`packages/platform-integrations/src/types.ts`). An operation the platform does not permit throws `UnsupportedOperationError`, carrying its honest status. The same matrix is served by `GET /api/v1/platforms` and shown in the UI.

Statuses: **IMPLEMENTED** (automated, covered by tests) · **AWAITING_CREDENTIALS** (built against a documented API, needs keys) · **USER_ASSISTED** (the user performs the step; the extension helps) · **MOCKED** · **UNSUPPORTED** (not permitted / awaiting platform authorization).

| Operation | Sandbox board | Greenhouse | Lever | LinkedIn | Indeed | Naukri |
|---|---|---|---|---|---|---|
| authenticate | Implemented | Implemented (board tokens) | Implemented (site names) | User-assisted | User-assisted | User-assisted |
| searchJobs | Implemented | Implemented¹ | Implemented¹ | **Unsupported** | **Unsupported** | **Unsupported** |
| fetchJobDetails | Implemented | Implemented¹ | Implemented¹ | User-assisted (extension capture) | User-assisted | User-assisted |
| getApplicationForm | Implemented (Playwright) | Implemented¹ (public questions API) | User-assisted | User-assisted | User-assisted | User-assisted |
| fillApplicationForm | Implemented (Playwright) | User-assisted | User-assisted | User-assisted | User-assisted | User-assisted |
| submitApplication | Implemented (verified confirmation) | User-assisted² | User-assisted² | User-assisted | User-assisted | User-assisted |
| checkApplicationStatus | Implemented | User-assisted | User-assisted | User-assisted | User-assisted | User-assisted |

¹ Built against the public Greenhouse Job Board API and Lever Postings API, and **verified against recorded responses in the documented format**. The build environment had no outbound access to those hosts, so live calls weren't exercised. They need no credentials.
² Both APIs accept applications only with the *employer's* API key, so candidates submit the hosted form themselves (the extension fills the approved answers).

## Why LinkedIn, Indeed and Naukri are user-assisted

None of them offers a public job-search or apply API to third parties, and their terms prohibit scraping and automated applying. The platform therefore:

1. lets the user sign in in their own browser (including MFA). No password ever reaches AutoApply.
2. captures the job page the user is viewing via the extension (schema.org `JobPosting` JSON-LD, with visible page text as fallback) → `POST /jobs/capture`, then normalizes, deduplicates and scores it like any other job.
3. prepares truthful answers in the app; the extension fills only **approved** values, leaves consents, file uploads and CAPTCHAs to the user, and never clicks submit.
4. records the submission once the user confirms it (`POST /extension/events`), with the status shown as user-confirmed rather than platform-verified.

Automated search or submission can be switched on later by implementing the relevant operations in the adapter once partner API access exists. The orchestrator already prefers automated sources.

## Adding a platform

1. Create `packages/platform-integrations/src/adapters/<name>.ts` extending `BaseAdapter`, with an honest `capabilities` matrix.
2. Implement the operations the platform permits; leave the rest to the base class (it throws `UnsupportedOperationError`).
3. Register it in `PlatformRegistry` and add the key to `PLATFORM_KEYS` (`packages/shared/src/enums.ts`).
4. Add tests against recorded responses, or against the sandbox for browser flows. Never test against a live portal with real applications.

## Sandbox job board

`apps/sandbox-board` is a controlled test environment: 12 postings, a JSON search API, JSON-LD job pages, realistic application forms (file upload, select, radios, textarea, demographic and consent fields), server-side validation, confirmation pages with an `SBX-…` reference, a CAPTCHA-protected posting (`sbx-1009`), and a status API (`POST /api/applications/:ref/status` to simulate interviews or rejections). It is the target for discovery and auto-apply E2E tests, and it is not a real employer. Remove it from production deployments.
