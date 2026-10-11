import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The endpoint Claude Code's own /usage reads. It answers for the claude.ai
// account behind the OAuth token, so the figures are the account's, whichever
// machine or app spent them.
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const HOUR = 3_600_000;

// The two windows the bar shows, in order. `windowMs` is how long each runs, so
// the client can mark how far through it we are.
export const WINDOWS = [
  { key: 'five_hour', label: '5-hour', windowMs: 5 * HOUR },
  { key: 'seven_day', label: 'Weekly', windowMs: 7 * 24 * HOUR },
];

// Claude Code keeps its login in <config dir>/.credentials.json on Linux and
// Windows, and in the login keychain on macOS. Read-only: refreshing would
// rotate the refresh token under Claude Code's feet, and any running session
// refreshes it anyway.
export async function readCredentials({ env = process.env, platform = process.platform, read = readFile, keychain = readKeychain } = {}) {
  const dir = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  let raw = null;
  try {
    raw = await read(join(dir, '.credentials.json'), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (raw == null && platform === 'darwin') raw = await keychain();
  if (raw == null) return null;
  const oauth = JSON.parse(raw)?.claudeAiOauth;
  if (!oauth?.accessToken) return null;
  return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt ?? null };
}

function readKeychain() {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

// The API's answer cut down to what the bar draws. A window the account
// doesn't have (or that the API stops sending) is left out rather than drawn
// at 0%.
export function parseUsage(body) {
  const windows = [];
  for (const w of WINDOWS) {
    const entry = body?.[w.key];
    if (!entry || typeof entry.utilization !== 'number') continue;
    const resetsAt = Date.parse(entry.resets_at);
    windows.push({
      key: w.key,
      label: w.label,
      windowMs: w.windowMs,
      percent: Math.max(0, entry.utilization),
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    });
  }
  return windows;
}

const LOGIN_HINT = 'Claude login has expired. Start or resume any Claude session to refresh it.';

// One fetch: resolves { ok: true, windows } or { ok: false, error } and never
// throws, so a sweep can't take anything down with it.
export async function fetchUsage({ now = Date.now(), creds = readCredentials, fetchImpl = fetch } = {}) {
  let c;
  try {
    c = await creds();
  } catch (err) {
    return { ok: false, error: `Couldn't read the Claude login: ${err.message}` };
  }
  if (!c) return { ok: false, error: 'No Claude login found. Run `claude` and log in with your claude.ai account.' };
  if (c.expiresAt && c.expiresAt <= now) return { ok: false, error: LOGIN_HINT };
  let res;
  try {
    res = await fetchImpl(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${c.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, error: `Couldn't reach Anthropic: ${err.message}` };
  }
  if (res.status === 401) return { ok: false, error: LOGIN_HINT };
  if (res.status === 429) return { ok: false, error: 'Rate limited by the usage endpoint; will retry.', retryAfterMs: retryAfterMs(res) };
  if (!res.ok) return { ok: false, error: `Usage endpoint answered HTTP ${res.status}.` };
  try {
    const windows = parseUsage(await res.json());
    if (!windows.length) return { ok: false, error: 'This account reports no 5-hour or weekly limit.' };
    return { ok: true, windows };
  } catch (err) {
    return { ok: false, error: `Unreadable usage response: ${err.message}` };
  }
}

function retryAfterMs(res) {
  const s = Number(res.headers?.get?.('retry-after'));
  return Number.isFinite(s) && s > 0 ? s * 1000 : null;
}
