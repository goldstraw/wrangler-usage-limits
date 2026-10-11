import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toneFor, formatDuration, elapsedFraction, meterText } from './index.js';

const H = 3_600_000;

test('toneFor', () => {
  assert.equal(toneFor(0), 'ok');
  assert.equal(toneFor(74.9), 'ok');
  assert.equal(toneFor(75), 'warn');
  assert.equal(toneFor(90), 'danger');
  assert.equal(toneFor(130), 'danger');
});

test('formatDuration', () => {
  assert.equal(formatDuration(-5), 'now');
  assert.equal(formatDuration(30_000), '<1m');
  assert.equal(formatDuration(12 * 60_000), '12m');
  assert.equal(formatDuration(3 * H + 28 * 60_000), '3h 28m');
  assert.equal(formatDuration(2 * H), '2h');
  assert.equal(formatDuration(52 * H), '2d 4h');
  assert.equal(formatDuration(48 * H), '2d');
});

test('elapsedFraction is clamped and needs a reset time', () => {
  const win = { windowMs: 5 * H, resetsAt: 10 * H };
  assert.equal(elapsedFraction(win, 5 * H), 0);
  assert.equal(elapsedFraction(win, 7.5 * H), 0.5);
  assert.equal(elapsedFraction(win, 11 * H), 1);
  assert.equal(elapsedFraction({ windowMs: 5 * H, resetsAt: null }, 0), null);
});

test('meterText', () => {
  const t = meterText({ label: '5-hour', percent: 11.4, windowMs: 5 * H, resetsAt: 10 * H }, 6 * H);
  assert.equal(t.pct, '11%');
  assert.equal(t.left, 'resets in 4h');
  assert.match(t.title, /5-hour limit: 11% used\n20% of the window has passed\nResets /);
});
