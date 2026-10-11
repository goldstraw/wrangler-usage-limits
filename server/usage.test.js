import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, fetchUsage, readCredentials, USAGE_URL } from './usage.js';

const BODY = {
  five_hour: { utilization: 11.0, resets_at: '2026-10-12T00:00:00.371266+00:00' },
  seven_day: { utilization: 21.0, resets_at: '2026-10-16T01:00:00.371284+00:00' },
  seven_day_opus: null,
};

test('parseUsage keeps the 5-hour and weekly windows in order', () => {
  const w = parseUsage(BODY);
  assert.deepEqual(w.map((x) => [x.key, x.label, x.percent]), [['five_hour', '5-hour', 11], ['seven_day', 'Weekly', 21]]);
  assert.equal(w[0].resetsAt, Date.parse('2026-10-12T00:00:00.371Z'));
  assert.equal(w[1].windowMs, 7 * 24 * 3_600_000);
});

test('parseUsage drops a window the account does not have, and survives a bad reset time', () => {
  const w = parseUsage({ five_hour: null, seven_day: { utilization: 5, resets_at: null } });
  assert.equal(w.length, 1);
  assert.equal(w[0].key, 'seven_day');
  assert.equal(w[0].resetsAt, null);
  assert.deepEqual(parseUsage(null), []);
});

const creds = async () => ({ accessToken: 'tok', expiresAt: 2_000 });
const json = (status, body, headers = {}) => ({ ok: status < 400, status, json: async () => body, headers: new Map(Object.entries(headers)) });

test('fetchUsage sends the bearer token and beta header', async () => {
  let seen;
  const res = await fetchUsage({ now: 1_000, creds, fetchImpl: async (url, init) => { seen = { url, init }; return json(200, BODY); } });
  assert.equal(seen.url, USAGE_URL);
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(seen.init.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(res.ok, true);
  assert.equal(res.windows.length, 2);
});

test('fetchUsage does not call out with an expired or missing login', async () => {
  const fetchImpl = async () => { throw new Error('should not fetch'); };
  assert.match((await fetchUsage({ now: 3_000, creds, fetchImpl })).error, /expired/);
  assert.match((await fetchUsage({ now: 1, creds: async () => null, fetchImpl })).error, /No Claude login/);
});

test('fetchUsage turns HTTP failures into errors, never throws', async () => {
  assert.match((await fetchUsage({ now: 1, creds, fetchImpl: async () => json(401, {}) })).error, /expired/);
  const limited = await fetchUsage({ now: 1, creds, fetchImpl: async () => json(429, {}, { 'retry-after': '120' }) });
  assert.equal(limited.ok, false);
  assert.equal(limited.retryAfterMs, 120_000);
  assert.match((await fetchUsage({ now: 1, creds, fetchImpl: async () => json(500, {}) })).error, /HTTP 500/);
  assert.match((await fetchUsage({ now: 1, creds, fetchImpl: async () => { throw new Error('ENOTFOUND'); } })).error, /ENOTFOUND/);
  assert.match((await fetchUsage({ now: 1, creds: async () => { throw new Error('bad json'); } })).error, /bad json/);
});

test('readCredentials reads the config dir, and the keychain only on macOS', async () => {
  const file = JSON.stringify({ claudeAiOauth: { accessToken: 'a', expiresAt: 5 } });
  let path;
  const got = await readCredentials({ env: { CLAUDE_CONFIG_DIR: '/cfg' }, platform: 'linux', read: async (p) => { path = p; return file; } });
  assert.equal(path, '/cfg/.credentials.json');
  assert.deepEqual(got, { accessToken: 'a', expiresAt: 5 });
  const enoent = async () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); };
  assert.equal(await readCredentials({ env: {}, platform: 'linux', read: enoent, keychain: async () => file }), null);
  assert.equal((await readCredentials({ env: {}, platform: 'darwin', read: enoent, keychain: async () => file })).accessToken, 'a');
});
