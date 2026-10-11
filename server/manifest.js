import { fileURLToPath } from 'node:url';
import { fetchUsage } from './usage.js';

// The extension manifest (agent-wrangler docs/extensions.md). `dir` is the repo
// root so `client`/`styles` resolve inside `<dir>/public/`; for an installed
// copy discovery overwrites it with the real location.
export const dir = fileURLToPath(new URL('..', import.meta.url));

export const DEFAULT_POLL_MINUTES = 2;
const MAX_BACKOFF_MS = 30 * 60_000;

export function pollMs(setting) {
  const n = Number(setting);
  return Number.isFinite(n) && n >= 1 ? n * 60_000 : DEFAULT_POLL_MINUTES * 60_000;
}

// What every browser was last told: { ok, windows, fetchedAt, error?, stale? }.
// A failed fetch keeps the last good windows (marked stale) so the bar doesn't
// blank over one bad response.
export function createPoller({ fetcher = fetchUsage } = {}) {
  let latest = null;
  let lastAttempt = 0;
  let failures = 0;
  let notBefore = 0;
  let inflight = null;

  async function poll(host, now = Date.now()) {
    if (inflight) return inflight;
    lastAttempt = now;
    inflight = (async () => {
      const res = await fetcher({ now });
      if (res.ok) {
        failures = 0;
        notBefore = 0;
        latest = { ok: true, windows: res.windows, fetchedAt: now };
      } else {
        failures += 1;
        // Back off on repeated failures (and honour a 429's Retry-After) so a
        // dead login or an outage isn't hammered every sweep.
        const backoff = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** (failures - 1));
        notBefore = now + Math.max(backoff, res.retryAfterMs || 0);
        if (failures === 1) host.log(`usage fetch failed: ${res.error}`);
        latest = {
          ok: false,
          error: res.error,
          windows: latest?.windows || [],
          fetchedAt: latest?.fetchedAt ?? null,
          stale: Boolean(latest?.windows?.length),
        };
      }
      host.broadcast({ usage: latest });
      return latest;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  return {
    poll,
    // The sweep: fetch when the poll interval has passed and any backoff is over.
    tick(host, now = Date.now()) {
      if (now < notBefore) return null;
      if (latest && now - lastAttempt < pollMs(host.settings.get('pollMinutes'))) return null;
      return poll(host, now);
    },
    // A board that just loaded: answer from memory, fetching only if there is
    // nothing yet.
    hello(host, now = Date.now()) {
      if (latest) host.broadcast({ usage: latest });
      else if (now >= notBefore) return poll(host, now);
      return null;
    },
    get latest() { return latest; },
  };
}

const poller = createPoller();

export default {
  id: 'usage-limits',
  label: 'Claude usage limits',
  description: 'A bar above the board showing how much of your Claude 5-hour and weekly usage limits you have used, and when each resets.',
  help: 'Reads the claude.ai login Claude Code already has (~/.claude/.credentials.json, or the macOS keychain) and asks Anthropic for the account\'s usage, the same figures /usage shows. Each meter\'s fill is the share of the limit used; the thin tick is how far through the window you are, so a fill past the tick means you are using it faster than it resets.',
  author: 'Charlie Goldstraw',
  homepage: 'https://github.com/goldstraw/wrangler-usage-limits',
  defaultEnabled: true,
  dir,
  requires: ['board:broadcast'],
  engines: { wranglerApi: '^1.15.0' },

  settings: [{
    key: 'pollMinutes',
    type: 'number',
    label: 'Refresh every (minutes)',
    help: `How often to ask Anthropic for fresh figures. Empty uses ${DEFAULT_POLL_MINUTES}.`,
    placeholder: String(DEFAULT_POLL_MINUTES),
    min: 1,
    max: 60,
    step: 1,
  }],

  handlers: [
    { type: 'usage-limits-hello', handler: (msg, host) => { poller.hello(host); } },
    { type: 'usage-limits-refresh', handler: async (msg, host) => { await poller.poll(host); } },
  ],

  sweeps: [{ id: 'poll', everyMs: 30_000, run: ({ host }) => { poller.tick(host); } }],

  client: 'public/index.js',
  styles: 'public/usage-limits.css',
};
