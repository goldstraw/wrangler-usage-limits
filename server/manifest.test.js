import { test } from 'node:test';
import assert from 'node:assert/strict';
import manifest, { createPoller, pollMs, DEFAULT_POLL_MINUTES } from './manifest.js';

function fakeHost(settings = {}) {
  const sent = [];
  return { sent, broadcast: (m) => sent.push(m), log: () => {}, settings: { get: (k) => settings[k] } };
}
const WINDOWS = [{ key: 'five_hour', percent: 11 }];

test('manifest agrees with package.json', async () => {
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.id, pkg.wranglerExtension.id);
  assert.deepEqual(manifest.requires, pkg.wranglerExtension.requires);
  assert.equal(manifest.label, pkg.wranglerExtension.label);
});

test('pollMs falls back to the default for empty or silly values', () => {
  assert.equal(pollMs(undefined), DEFAULT_POLL_MINUTES * 60_000);
  assert.equal(pollMs(0), DEFAULT_POLL_MINUTES * 60_000);
  assert.equal(pollMs(5), 300_000);
});

test('tick fetches once per interval and broadcasts the result', async () => {
  let calls = 0;
  const p = createPoller({ fetcher: async () => { calls += 1; return { ok: true, windows: WINDOWS }; } });
  const host = fakeHost({ pollMinutes: 2 });
  await p.tick(host, 0);
  assert.equal(p.tick(host, 60_000), null);
  await p.tick(host, 120_000);
  assert.equal(calls, 2);
  assert.deepEqual(host.sent.at(-1), { usage: { ok: true, windows: WINDOWS, fetchedAt: 120_000 } });
});

test('a failure keeps the last good windows as stale and backs off', async () => {
  let ok = true;
  const p = createPoller({ fetcher: async () => (ok ? { ok: true, windows: WINDOWS } : { ok: false, error: 'boom' }) });
  const host = fakeHost();
  await p.tick(host, 0);
  ok = false;
  await p.poll(host, 1_000);
  assert.deepEqual(host.sent.at(-1).usage, { ok: false, error: 'boom', windows: WINDOWS, fetchedAt: 0, stale: true });
  // Backing off for a minute after the first failure.
  assert.equal(p.tick(host, 30_000), null);
});

test('hello answers from memory, fetching only when there is nothing yet', async () => {
  let calls = 0;
  const p = createPoller({ fetcher: async () => { calls += 1; return { ok: true, windows: WINDOWS }; } });
  const host = fakeHost();
  await p.hello(host, 0);
  p.hello(host, 1);
  assert.equal(calls, 1);
  assert.equal(host.sent.length, 2);
});

test('concurrent polls share one fetch', async () => {
  let calls = 0;
  const p = createPoller({ fetcher: async () => { calls += 1; return { ok: true, windows: WINDOWS }; } });
  await Promise.all([p.poll(fakeHost(), 0), p.poll(fakeHost(), 0)]);
  assert.equal(calls, 1);
});
