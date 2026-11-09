import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ rateLimit: true });
});
afterAll(async () => {
  await h?.close();
});

describe('rate limiting', () => {
  it('throttles repeated login attempts per client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await h.client().post('/auth/login', { email: 'x@example.com', password: 'whatever-123' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
