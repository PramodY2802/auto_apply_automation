# Security & privacy

| Control | Implementation |
|---|---|
| Passwords | Argon2id (`@node-rs/argon2`); ≥10 chars with a letter and a number; generic error on bad credentials with equalized timing; lockout after 5 failures (15 min) |
| Sessions | Random 256-bit token in an httpOnly, SameSite=Lax cookie (`Secure` in production); only the SHA-256 hash is stored; sliding last-seen; revocable per device; all sessions revoked on password reset and on suspension |
| CSRF | Per-session token (double-submit header `x-csrf-token`) required on every cookie-authenticated mutation |
| API tokens | `aa_pat_…`, hashed at rest, scoped (`extension`), 180-day expiry, revocable, shown once; cannot reach non-extension endpoints |
| RBAC | DB-backed role → permission mapping enforced by a global guard (`@RequirePermissions`); Platform Admins cannot change roles or modify administrators; users cannot change their own role or status |
| Tenant isolation | Every query is scoped by server-side identity (user / enterprise from membership); other tenants' resources return 404; enterprise endpoints never take an enterprise ID from the request |
| Secrets | AES-256-GCM envelopes with key IDs (rotation-ready) for AI keys and platform credentials; secrets are never returned by the API (only `apiKeyLast4`); never sent to the frontend or the extension; Gemini keys sent as a header, not in the URL |
| Logging | Structured JSON; keys matching password/secret/token/api key/cookie/session/credential are redacted; emails and phone numbers are masked in messages; AI prompts and answers are not logged (only token counts and cost) |
| Uploads | Magic-byte type detection, extension/content mismatch rejection, size limit, sanitized filenames, per-user dedupe by SHA-256, private storage (S3 SSE / 0600 files), `Content-Disposition: attachment`, `no-store` |
| Input validation | zod on every body/query; UUID checks on path params; JSON body limit 1 MB |
| Rate limiting | Global per-IP limit plus stricter limits on signup/login/reset/verify |
| HTTP hardening | helmet headers on the API; X-Frame-Options/nosniff/Referrer/Permissions policies on web; CORS restricted to the web origin and the configured extension origins |
| Browser automation | Isolated context per operation; no credential storage in plaintext (`browser_sessions.encrypted_state`); optional host allow-list; stops at CAPTCHA/anti-bot challenges; never auto-retries submission |
| Audit | Append-only `audit_logs` (signup/login/failed login, profile and resume actions, AI config changes, consent to auto-apply, approvals, admin actions, billing changes) |
| Data rights | JSON export; account deletion with file removal; resume deletion also clears extracted text |

Verified by tests in `apps/api/test/api.test.ts`: cross-tenant access, unauthorized and role-escalation attempts, CSRF, secret exposure (DB ciphertext vs. API responses), hashed session tokens, session revocation, lockout and rate limiting, and the API-token scope.

Known gaps: see [BUILD_REPORT.md](BUILD_REPORT.md#remaining-work) (MFA for platform accounts, Postgres row-level security as defence in depth, malware scanning of uploads, automated retention purge).
