# API

- Base path: `/api/v1` (URI versioning). Interactive docs: `GET /api/docs`; JSON: `GET /api/docs/openapi.json`; a generated snapshot is in [`openapi.json`](openapi.json) (98 paths). Regenerate it with `node apps/api/dist/cli/openapi.js`.
- **Browser auth**: `POST /auth/login` sets `aa_session` (httpOnly) and `aa_csrf` cookies. Every non-GET request must send `x-csrf-token: <aa_csrf>`.
- **Extension auth**: `Authorization: Bearer aa_pat_…` (created in Settings → Extension). It only works on endpoints marked for the `extension` scope (`/extension/*`, `/jobs/capture`).
- Errors: `{ code, message, details?, issues?, requestId }`. Status codes: 400 validation · 401 · 403 (RBAC/CSRF/scope) · 404 (also returned for other tenants' resources) · 409 conflict/duplicate · 402 plan limit or feature · 415 file type · 422 precondition/unsupported operation · 429 rate limit · 502 upstream provider.

| Group | Endpoints |
|---|---|
| auth | `POST /auth/signup` `login` `logout` `verify-email` `resend-verification` `password/forgot` `password/reset` `password/change` |
| account | `GET/PUT/DELETE /me`, `GET /me/export`, `GET/DELETE /me/sessions[/:id]`, `GET/POST/DELETE /me/api-tokens[/:id]` |
| resumes | `POST /resumes` (multipart `file`), `GET /resumes`, `GET /resumes/:id/extraction`, `POST /resumes/:id/extraction/apply`, `POST /resumes/:id/reprocess`, `POST /resumes/:id/primary`, `GET /resumes/:id/file`, `DELETE /resumes/:id` |
| profile | `GET/PUT /profile`, `GET/PUT /preferences` |
| jobs | `GET /jobs?view&q&platform&minScore&workMode&sort&order&page&pageSize`, `GET /jobs/views/counts`, `GET /jobs/:id`, `POST /jobs/:id/flags/:action` (hide/unhide/save/unsave/seen), `POST /jobs/bulk`, `POST /jobs/capture` |
| discovery | `POST /discovery/runs`, `GET /discovery/runs[/:id]`, `POST /discovery/runs/:id/cancel` |
| platforms | `GET /platforms`, `POST /platforms/:key/connect`, `DELETE /platforms/:key` |
| applications | `GET/POST /applications`, `GET /applications/stats`, `GET /applications/:id`, `GET /applications/:id/evidence`, `PUT /applications/:id/answers/:answerId`, `POST /applications/:id/{approve,prepare,status,confirm-submitted,withdraw,sync}`, `POST /applications/external`, `GET/PUT/DELETE /saved-answers[/:id]` |
| extension | `GET /extension/status`, `POST /extension/platform-session`, `GET /extension/prepared?url=`, `POST /extension/events` |
| ai | `GET /ai/providers`, `GET/POST /ai/configs?scope=USER|ENTERPRISE|PLATFORM`, `POST /ai/configs/:id/{activate,health}`, `DELETE /ai/configs/:id`, `GET /ai/effective`, `GET /ai/usage?scope&days`, `PUT /admin/ai/providers/:key` |
| billing | `GET /billing/plans` (public), `GET/POST /billing/subscription`, `POST /billing/subscription/cancel`, `GET /billing/invoices`, `GET /billing/usage` |
| notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` |
| enterprise | `GET /enterprise`, `PUT /enterprise/settings`, `GET /enterprise/members`, `PUT/DELETE /enterprise/members/:id`, `GET/POST /enterprise/invitations`, `DELETE /enterprise/invitations/:id`, `POST /enterprise/invitations/accept`, `GET/POST/DELETE /enterprise/teams`, `GET /enterprise/analytics`, `GET /enterprise/activity` |
| admin | `GET /admin/{metrics,system,integrations,users,enterprises,plans,subscriptions,invoices,audit-logs,settings}`, `PUT /admin/users/:id`, `POST/PUT /admin/enterprises`, `POST/PUT /admin/plans`, `POST /admin/invoices/:id/mark-paid`, `POST /admin/billing/run`, `PUT /admin/settings/:key` |
| health | `GET /health`, `GET /health/ready` |
