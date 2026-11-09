import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiProviderConfigs, eq, invoices, sessions, sql, subscriptions, usageRecords, users } from '@autoapply/database';
import { periodKey } from '@autoapply/services';
import { ApiClient } from './client';
import { PASSWORD, startHarness, type Harness } from './harness';

const FIXTURE = path.resolve(__dirname, '../../../packages/document-extraction/src/__fixtures__/resume.pdf');

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

async function upload(c: ApiClient, file = FIXTURE, name = 'cv.pdf', type = 'application/pdf') {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type }), name);
  return c.req('POST', '/resumes', undefined, { form });
}

describe('authentication', () => {
  it('signs up, reads /me, logs out', async () => {
    const c = await h.signup('ann@example.com');
    const me = await c.get('/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'ann@example.com', platformRole: 'USER', emailVerified: false });
    expect(me.body.plan.key).toBe('free');
    expect(me.body.permissions).toContain('profile:manage');
    expect(me.body.permissions).not.toContain('admin:users:read');
    expect((await c.post('/auth/logout')).status).toBe(204);
    expect((await c.get('/me')).status).toBe(401);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    expect((await h.client().post('/auth/signup', { email: 'ann@example.com', password: PASSWORD, fullName: 'X' })).status).toBe(409);
    const weak = await h.client().post('/auth/signup', { email: 'weak@example.com', password: 'short', fullName: 'X' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('VALIDATION');
  });

  it('uses a generic error for bad credentials and locks after repeated failures', async () => {
    await h.signup('lock@example.com');
    const unknown = await h.client().post('/auth/login', { email: 'nobody@example.com', password: 'whatever-123' });
    const wrong = await h.client().post('/auth/login', { email: 'lock@example.com', password: 'wrong-password-1' });
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    for (let i = 0; i < 4; i++) await h.client().post('/auth/login', { email: 'lock@example.com', password: 'wrong-password-1' });
    const locked = await h.client().post('/auth/login', { email: 'lock@example.com', password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('requires a CSRF token for cookie-authenticated mutations', async () => {
    const c = await h.signup('csrf@example.com');
    const cookie = `aa_session=${(c as any).cookies.get('aa_session')}`;
    const res = await fetch(`${h.url}/api/v1/me`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Hacker' }) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('CSRF');
    expect((await c.put('/me', { fullName: 'Legit' })).status).toBe(200);
  });

  it('verifies email and resets password (revoking existing sessions)', async () => {
    const c = await h.signup('reset@example.com');
    const verify = h.mailer.outbox.find((m) => m.to === 'reset@example.com' && /Verify/.test(m.subject))!;
    expect((await h.client().post('/auth/verify-email', { token: /token=([\w-]+)/.exec(verify.text)![1] })).status).toBe(204);
    expect((await c.get('/me')).body.user.emailVerified).toBe(true);
    expect((await h.client().post('/auth/password/forgot', { email: 'reset@example.com' })).status).toBe(204);
    expect((await h.client().post('/auth/password/forgot', { email: 'nobody@example.com' })).status).toBe(204);
    const mail = h.mailer.outbox.filter((m) => m.to === 'reset@example.com' && /Reset/.test(m.subject)).pop()!;
    const token = /token=([\w-]+)/.exec(mail.text)![1];
    expect((await h.client().post('/auth/password/reset', { token, password: 'Brand-new-pass-1' })).status).toBe(204);
    expect((await c.get('/me')).status).toBe(401); // old session revoked
    expect((await h.client().post('/auth/password/reset', { token, password: 'Another-pass-22' })).status).toBe(400); // single use
    expect((await h.client().post('/auth/login', { email: 'reset@example.com', password: 'Brand-new-pass-1' })).status).toBe(200);
  });

  it('stores only hashes of session tokens', async () => {
    const c = await h.signup('hash@example.com');
    const raw = (c as any).cookies.get('aa_session') as string;
    const rows = await h.c.db.select({ t: sessions.tokenHash }).from(sessions);
    expect(rows.some((r) => r.t === raw)).toBe(false);
  });
});

describe('profile, resumes and preferences', () => {
  it('uploads a resume (validated, stored, queued) and rejects disguised files', async () => {
    const c = await h.signup('cand@example.com');
    const up = await upload(c);
    expect(up.status).toBe(201);
    expect(up.body.resume.isPrimary).toBe(true);
    expect(up.body.resume.storageKey).toBeUndefined();
    expect((await upload(c)).status).toBe(409); // same file
    const fake = await upload(c, FIXTURE, 'cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(fake.status).toBe(415);
    const list = await c.get('/resumes');
    expect(list.body).toHaveLength(1);
    const file = await fetch(`${h.url}/api/v1/resumes/${up.body.resume.id}/file`, { headers: { cookie: `aa_session=${(c as any).cookies.get('aa_session')}` } });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(/attachment/);
  });

  it('validates preferences and gates automatic mode behind consent and plan', async () => {
    const c = await h.signup('prefs@example.com');
    expect((await c.put('/preferences', { titles: [] })).status).toBe(400);
    expect((await c.put('/preferences', { titles: ['Engineer'], applicationMode: 'AUTOMATIC' })).status).toBe(400);
    const plan = await c.put('/preferences', { titles: ['Engineer'], applicationMode: 'AUTOMATIC', autoApplyConsent: true });
    expect(plan.status).toBe(402); // Free plan has no auto-apply
    const ok = await c.put('/preferences', { titles: ['Engineer'], experienceBand: '3-5' });
    expect(ok.body).toMatchObject({ experienceMinYears: 3, experienceMaxYears: 5 });
  });

  it('updates the profile with normalized skills', async () => {
    const c = await h.signup('skills@example.com');
    const r = await c.put('/profile', { fullName: 'Sk Ill', skills: [{ name: 'reactjs', category: 'FRAMEWORK' }, { name: 'React', category: 'FRAMEWORK' }, { name: 'postgres', category: 'DATABASE', years: 3 }], markReviewed: true });
    expect(r.status).toBe(200);
    expect(r.body.skills.map((s: any) => s.name).sort()).toEqual(['PostgreSQL', 'React']);
  });
});

describe('security: tenant isolation', () => {
  let a: ApiClient;
  let b: ApiClient;
  let resumeId: string;
  beforeAll(async () => {
    a = await h.signup('tenant-a@example.com');
    b = await h.signup('tenant-b@example.com');
    resumeId = (await upload(a)).body.resume.id;
  });

  it('prevents cross-tenant access to resumes, files, extractions and jobs', async () => {
    expect((await b.get(`/resumes/${resumeId}/extraction`)).status).toBe(404);
    expect((await b.get(`/resumes/${resumeId}/file`)).status).toBe(404);
    expect((await b.del(`/resumes/${resumeId}`)).status).toBe(404);
    expect((await b.get('/resumes')).body).toHaveLength(0);
    expect((await a.get(`/resumes/${resumeId}/extraction`)).status).toBe(200);
  });

  it('prevents cross-tenant access to applications and AI configs', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    expect((await b.get(`/applications/${fakeId}`)).status).toBe(404);
    expect((await b.get('/applications')).body.items).toHaveLength(0);
    expect((await b.post(`/ai/configs/${fakeId}/activate`)).status).toBe(404);
  });

  it('rejects malformed ids', async () => {
    expect((await a.get('/resumes/not-a-uuid/extraction')).status).toBe(400);
  });
});

describe('security: RBAC and role escalation', () => {
  it('blocks regular users from admin endpoints', async () => {
    const u = await h.signup('plain@example.com');
    for (const p of ['/admin/metrics', '/admin/users', '/admin/plans', '/admin/audit-logs', '/admin/settings']) {
      expect((await u.get(p)).status).toBe(403);
    }
    const me = (await u.get('/me')).body.user.id;
    expect((await u.put(`/admin/users/${me}`, { platformRole: 'SUPER_ADMIN' })).status).toBe(403);
    expect((await u.get('/ai/configs?scope=PLATFORM')).status).toBe(403);
    expect((await u.get('/enterprise')).status).toBe(403);
  });

  it('ignores privilege fields on signup', async () => {
    const c = await h.signup('sneaky@example.com', { platformRole: 'SUPER_ADMIN', permissions: ['admin:users:manage'] });
    expect((await c.get('/me')).body.user.platformRole).toBe('USER');
  });

  it('lets platform admins support users but not grant roles or touch admins', async () => {
    const pa = await h.createAdmin('pa@example.com', 'PLATFORM_ADMIN');
    const sa = await h.createAdmin('sa@example.com', 'SUPER_ADMIN');
    const users = await pa.get('/admin/users?q=plain@example.com');
    expect(users.status).toBe(200);
    expect(JSON.stringify(users.body)).not.toMatch(/passwordHash|password_hash|\$argon2/);
    const target = users.body.items[0].id;
    expect((await pa.put(`/admin/users/${target}`, { platformRole: 'PLATFORM_ADMIN' })).status).toBe(403);
    expect((await pa.put(`/admin/users/${target}`, { status: 'SUSPENDED' })).status).toBe(200);
    const saId = (await sa.get('/me')).body.user.id;
    expect((await pa.put(`/admin/users/${saId}`, { status: 'SUSPENDED' })).status).toBe(403);
    expect((await pa.get('/admin/plans')).status).toBe(403);
    // Suspended user's sessions are revoked.
    const suspended = h.client();
    expect((await suspended.post('/auth/login', { email: 'plain@example.com', password: PASSWORD })).status).toBe(403);
    expect((await sa.put(`/admin/users/${target}`, { status: 'ACTIVE' })).status).toBe(200);
  });

  it('super admin can view metrics, audit logs and change settings', async () => {
    const sa = h.client();
    await sa.post('/auth/login', { email: 'sa@example.com', password: PASSWORD });
    const m = await sa.get('/admin/metrics');
    expect(m.status).toBe(200);
    expect(m.body.users.total).toBeGreaterThan(3);
    expect(m.body.revenue).not.toBeNull();
    expect((await sa.put('/admin/settings/matching.weights', { value: { skill: 0.5, experience: 0.2, location: 0.1, preference: 0.1, salary: 0.1 } })).status).toBe(200);
    expect((await sa.put('/admin/settings/matching.weights', { value: { skill: 0.9, experience: 0.9, location: 0, preference: 0, salary: 0 } })).status).toBe(400);
    const audit = await sa.get('/admin/audit-logs?action=admin.user');
    expect(audit.body.length).toBeGreaterThan(0);
  });
});

describe('security: AI secrets', () => {
  it('encrypts provider keys at rest and never returns them', async () => {
    const sa = h.client();
    await sa.post('/auth/login', { email: 'sa@example.com', password: PASSWORD });
    const secret = 'sk-test-THIS-MUST-NOT-LEAK-12345';
    const r = await sa.post('/ai/configs', { scope: 'PLATFORM', providerKey: 'openai', defaultModel: 'gpt-4.1-mini', apiKey: secret });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain(secret);
    expect(r.body.hasApiKey).toBe(true);
    const list = await sa.get('/ai/configs?scope=PLATFORM');
    expect(JSON.stringify(list.body)).not.toContain('THIS-MUST-NOT-LEAK');
    const [row] = await h.c.db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, r.body.id));
    expect(row!.encryptedApiKey).not.toContain(secret);
    expect(h.c.box.decrypt(row!.encryptedApiKey!)).toBe(secret);
    expect((await sa.post('/ai/configs', { scope: 'PLATFORM', providerKey: 'openai', defaultModel: 'not-a-model' })).status).toBe(400);
  });

  it('only allows personal keys on plans with BYO', async () => {
    const u = await h.signup('byo@example.com');
    expect((await u.post('/ai/configs', { scope: 'USER', providerKey: 'anthropic', defaultModel: 'claude-haiku-4-5', apiKey: 'sk-ant-xxxxxxxxxxxx' })).status).toBe(402);
    await u.post('/billing/subscription', { planKey: 'basic' });
    const ok = await u.post('/ai/configs', { scope: 'USER', providerKey: 'anthropic', defaultModel: 'claude-haiku-4-5', apiKey: 'sk-ant-xxxxxxxxxxxx' });
    expect(ok.status).toBe(201);
    const eff = await u.get('/ai/effective');
    expect(eff.body.QUESTION_ANSWERING).toMatchObject({ provider: 'anthropic', scope: 'USER' });
  });
});

describe('enterprise', () => {
  let admin: ApiClient;
  it('creates an enterprise on signup with a trial subscription', async () => {
    admin = await h.signup('boss@acme.test', { accountType: 'ENTERPRISE', enterpriseName: 'Acme Talent' });
    const me = await admin.get('/me');
    expect(me.body.enterprise).toMatchObject({ name: 'Acme Talent', role: 'ENTERPRISE_ADMIN' });
    const o = await admin.get('/enterprise');
    expect(o.body.subscription.subscription.status).toBe('TRIALING');
    expect(o.body.subscription.plan.key).toBe('enterprise');
  });

  it('invites a member who joins via the invitation link', async () => {
    const inv = await admin.post('/enterprise/invitations', { email: 'dev@acme.test', role: 'ENTERPRISE_USER' });
    expect(inv.status).toBe(201);
    const mail = h.mailer.outbox.filter((m) => m.to === 'dev@acme.test').pop()!;
    const token = /invitation=([\w-]+)/.exec(mail.text)![1];
    const member = await h.signup('dev@acme.test', { invitationToken: token });
    const me = await member.get('/me');
    expect(me.body.enterprise.role).toBe('ENTERPRISE_USER');
    expect(me.body.plan.key).toBe('enterprise'); // inherits the enterprise plan
    expect((await member.get('/enterprise/members')).status).toBe(403);
    expect((await member.post('/enterprise/invitations', { email: 'x@acme.test' })).status).toBe(403);
    const members = await admin.get('/enterprise/members');
    expect(members.body.map((m: any) => m.email).sort()).toEqual(['boss@acme.test', 'dev@acme.test']);
    // Invitation token cannot be reused.
    expect((await h.client().post('/auth/signup', { email: 'dev2@acme.test', password: PASSWORD, fullName: 'D', invitationToken: token })).status).toBe(400);
  });

  it('isolates enterprises from each other', async () => {
    const other = await h.signup('boss@globex.test', { accountType: 'ENTERPRISE', enterpriseName: 'Globex' });
    const members = await other.get('/enterprise/members');
    expect(members.body.map((m: any) => m.email)).toEqual(['boss@globex.test']);
    const acmeMember = (await admin.get('/enterprise/members')).body.find((m: any) => m.email === 'dev@acme.test');
    expect((await other.put(`/enterprise/members/${acmeMember.id}`, { role: 'ENTERPRISE_ADMIN' })).status).toBe(404);
    expect((await other.del(`/enterprise/members/${acmeMember.id}`)).status).toBe(404);
    const activity = await other.get('/enterprise/activity');
    expect(activity.body.every((x: any) => x.actorEmail !== 'boss@acme.test')).toBe(true);
  });

  it('manages teams and analytics', async () => {
    const t = await admin.post('/enterprise/teams', { name: 'Campus Hiring' });
    expect(t.status).toBe(201);
    const member = (await admin.get('/enterprise/members')).body.find((m: any) => m.email === 'dev@acme.test');
    expect((await admin.put(`/enterprise/members/${member.id}`, { teamId: t.body.id })).status).toBe(200);
    const an = await admin.get('/enterprise/analytics');
    expect(an.body.byTeam.some((x: any) => x.team === 'Campus Hiring')).toBe(true);
    const self = (await admin.get('/enterprise/members')).body.find((m: any) => m.email === 'boss@acme.test');
    expect((await admin.put(`/enterprise/members/${self.id}`, { role: 'ENTERPRISE_USER' })).status).toBe(400);
  });
});

describe('billing and usage limits', () => {
  it('upgrades immediately and schedules downgrades for period end', async () => {
    const c = await h.signup('payer@example.com');
    const up = await c.post('/billing/subscription', { planKey: 'pro', interval: 'MONTHLY' });
    expect(up.body.effective).toBe('NOW');
    const down = await c.post('/billing/subscription', { planKey: 'basic', interval: 'MONTHLY' });
    expect(down.body.effective).toBe('PERIOD_END');
    const sub = await c.get('/billing/subscription');
    expect(sub.body.plan.key).toBe('pro');
    expect(sub.body.pendingPlan.key).toBe('basic');
    const inv = await c.get('/billing/invoices');
    expect(inv.body.some((i: any) => i.kind === 'SUBSCRIPTION' && i.amountCents === 3900)).toBe(true);
    // Simulate period end → renewal applies the downgrade and invoices it.
    const subId = sub.body.subscription.id;
    await h.c.db.update(subscriptions).set({ currentPeriodEnd: new Date(Date.now() - 1000) }).where(eq(subscriptions.id, subId));
    const r = await h.c.billing.processRenewals();
    expect(r.renewed).toBeGreaterThanOrEqual(1);
    expect((await c.get('/billing/subscription')).body.plan.key).toBe('basic');
    expect((await c.post('/billing/subscription', { planKey: 'enterprise' })).status).toBe(400);
  });

  it('bills platform-managed AI usage separately with markup', async () => {
    const c = await h.signup('aiuser@example.com');
    await c.post('/billing/subscription', { planKey: 'pro' });
    const userId = (await c.get('/me')).body.user.id;
    const prev = new Date();
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    await h.c.db.execute(sql`insert into ai_usage_logs (user_id, scope, provider, model, task, input_tokens, output_tokens, cost_usd, status, created_at) values (${userId}, 'PLATFORM', 'openai', 'gpt-4.1-mini', 'APPLICATION_ANSWER', 100000, 50000, 10.000000, 'ok', ${prev}), (${userId}, 'USER', 'openai', 'gpt-4.1-mini', 'APPLICATION_ANSWER', 100000, 50000, 99.000000, 'ok', ${prev})`);
    const key = periodKey(prev);
    expect(await h.c.billing.issueAiUsageInvoices(key)).toBeGreaterThanOrEqual(1);
    expect(await h.c.billing.issueAiUsageInvoices(key)).toBe(0); // idempotent
    const [inv] = await h.c.db.select().from(invoices).where(sql`${invoices.userId} = ${userId} and ${invoices.kind} = 'AI_USAGE'`);
    expect(inv!.amountCents).toBe(1200); // $10 provider cost (+20% Pro markup); BYO usage excluded
  });

  it('enforces plan limits', async () => {
    const c = await h.signup('limited@example.com');
    const userId = (await c.get('/me')).body.user.id;
    await c.put('/preferences', { titles: ['Engineer'] });
    await h.c.db.insert(usageRecords).values({ userId, metric: 'SEARCH', quantity: 30, periodKey: periodKey(), sourceId: 'seed-limit' });
    const r = await c.post('/discovery/runs', {});
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('LIMIT_EXCEEDED');
    const usage = await c.get('/billing/usage');
    expect(usage.body.usage.find((u: any) => u.metric === 'SEARCH')).toMatchObject({ used: 30, limit: 30 });
  });
});

describe('platforms and health', () => {
  it('describes integrations honestly', async () => {
    const c = await h.signup('plat@example.com');
    const r = await c.get('/platforms');
    const li = r.body.find((p: any) => p.key === 'linkedin');
    expect(li.capabilities.searchJobs.status).toBe('UNSUPPORTED');
    expect(li.supportsAutomatedSearch).toBe(false);
    const gh = await c.post('/platforms/greenhouse/connect', { settings: {} });
    expect(gh.body.status).toBe('PENDING_USER_ACTION');
    const gh2 = await c.post('/platforms/greenhouse/connect', { settings: { boards: ['examplecorp'], secretThing: 'x' } });
    expect(gh2.body.status).toBe('CONNECTED');
    const after = await c.get('/platforms');
    expect(after.body.find((p: any) => p.key === 'greenhouse').connection.settings).toEqual({ boards: ['examplecorp'] });
  });

  it('exposes liveness, readiness and OpenAPI docs', async () => {
    expect((await h.client().get('/health')).body.status).toBe('ok');
    expect((await h.client().get('/health/ready')).body.status).toBe('ready');
    const docs = await fetch(`${h.url}/api/docs/openapi.json`);
    const json: any = await docs.json();
    expect(Object.keys(json.paths).length).toBeGreaterThan(80);
  });

  it('deletes an account and its data', async () => {
    const c = await h.signup('gone@example.com');
    await upload(c);
    const id = (await c.get('/me')).body.user.id;
    expect((await c.del('/me', { confirm: 'DELETE' })).status).toBe(204);
    expect((await h.c.db.select().from(users).where(eq(users.id, id))).length).toBe(0);
    expect((await h.client().post('/auth/login', { email: 'gone@example.com', password: PASSWORD })).status).toBe(401);
  });
});
