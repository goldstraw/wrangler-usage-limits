// The client half: a bar above the task board with one meter per usage window
// (5-hour, weekly). The server broadcasts `{ usage }` whenever it fetches; the
// countdowns tick here between fetches.
//
// There is no core slot above the board, so the bar lives on <main> and
// tracks #grid's box. The stylesheet gives #grid a margin-top while the bar is
// showing, so the board's own layout (which measures #grid.clientHeight) packs
// tiles into the space that is left. Everything that makes the bar visible is
// in the stylesheet: the element carries `hidden`, which the sheet overrides,
// so turning the extension off (which removes the sheet) hides the bar and
// gives the board its space back without any code of ours running.

const BAR_ID = 'usage-limits-bar';
const SHOWING = 'usage-limits-on';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Below this #grid width the countdowns are dropped to keep both meters legible.
const NARROW_PX = 640;

export function toneFor(percent) {
  if (percent >= 90) return 'danger';
  if (percent >= 75) return 'warn';
  return 'ok';
}

// "3h 28m", "2d 4h", "12m", "<1m".
export function formatDuration(ms) {
  if (!(ms > 0)) return 'now';
  if (ms < MINUTE) return '<1m';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// How far through its window we are, 0–1, or null without a reset time.
export function elapsedFraction(win, now) {
  if (!win.resetsAt || !win.windowMs) return null;
  const f = 1 - (win.resetsAt - now) / win.windowMs;
  return Math.min(1, Math.max(0, f));
}

const clock = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function meterText(win, now) {
  const pct = `${Math.round(win.percent)}%`;
  const left = win.resetsAt ? `resets in ${formatDuration(win.resetsAt - now)}` : '';
  const elapsed = elapsedFraction(win, now);
  const title = [
    `${win.label} limit: ${pct} used`,
    elapsed == null ? null : `${Math.round(elapsed * 100)}% of the window has passed`,
    win.resetsAt ? `Resets ${clock.format(new Date(win.resetsAt))}` : null,
  ].filter(Boolean).join('\n');
  return { pct, left, title };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function meter(win, now) {
  const { pct, left, title } = meterText(win, now);
  const root = el('div', `usage-limits-meter tone-${toneFor(win.percent)}`);
  root.title = title;
  const track = el('div', 'usage-limits-track');
  const fill = el('div', 'usage-limits-fill');
  fill.style.width = `${Math.min(100, win.percent)}%`;
  track.append(fill);
  const elapsed = elapsedFraction(win, now);
  if (elapsed != null) {
    const tick = el('div', 'usage-limits-tick');
    tick.style.left = `${elapsed * 100}%`;
    track.append(tick);
  }
  root.append(el('span', 'usage-limits-label', win.label), track, el('span', 'usage-limits-pct', pct), el('span', 'usage-limits-reset', left));
  return root;
}

export function renderBar(bar, usage, now = Date.now()) {
  bar.replaceChildren();
  const windows = usage?.windows || [];
  if (!usage) {
    bar.append(el('span', 'usage-limits-note', 'Loading Claude usage…'));
    return;
  }
  for (const w of windows) bar.append(meter(w, now));
  if (!usage.ok) {
    const note = el('span', 'usage-limits-note usage-limits-error', windows.length ? '⚠ stale' : `⚠ ${usage.error}`);
    note.title = usage.fetchedAt
      ? `${usage.error}\nLast updated ${clock.format(new Date(usage.fetchedAt))}`
      : usage.error;
    bar.append(note);
  }
  bar.classList.toggle('is-stale', Boolean(usage.stale));
}

// Keep the bar over #grid's padding box: same left edge and width, sitting in
// the gap its margin-top opens up. Hidden whenever #grid is (search, an
// extension view, the maximised terminal).
export function placeBar(bar, grid) {
  const visible = grid.offsetWidth > 0 && grid.offsetHeight > 0 && !grid.classList.contains('hidden');
  bar.classList.toggle('usage-limits-away', !visible);
  if (!visible) return;
  bar.style.left = `${grid.offsetLeft}px`;
  bar.style.width = `${grid.offsetWidth}px`;
  bar.classList.toggle('is-narrow', grid.offsetWidth < NARROW_PX);
}

function mountBar(api) {
  const main = document.querySelector('main');
  const grid = document.getElementById('grid');
  if (!main || !grid) return null;
  // A re-enable re-runs register in the same page: reuse the old element.
  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = el('div');
    bar.id = BAR_ID;
    bar.hidden = true;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-label', 'Claude usage limits');
    main.prepend(bar);
  }
  grid.classList.add(SHOWING);
  main.classList.add(SHOWING);
  const place = () => placeBar(bar, grid);
  // Width changes (window, sidebar drag) come through the observer; the grid
  // moving sideways without resizing (terminal swapped to the left) and being
  // hidden by a class come through the mutation observer.
  new ResizeObserver(place).observe(grid);
  new MutationObserver(place).observe(main, { attributes: true, attributeFilter: ['class'], subtree: false });
  new MutationObserver(place).observe(grid, { attributes: true, attributeFilter: ['class', 'style'] });
  window.addEventListener('resize', place);
  place();
  // The margin just took height from #grid; repack the tiles into what is left.
  api.requestBoardRender?.();
  return bar;
}

// Module state survives a disable/re-enable in the same page (the module is
// imported once), so observers and the countdown timer are wired only once;
// only the onMessage subscription, which the board drops on disable, is redone.
let bar = null;
let usage = null;
let api = null;

export default {
  register(slots) {
    api = slots.api;
    if (!bar) {
      bar = mountBar(api);
      if (!bar) return;
      // Countdowns and the elapsed tick move between fetches.
      setInterval(() => { if (usage) renderBar(bar, usage); }, 30_000);
      bar.addEventListener('dblclick', () => api?.send({ type: 'usage-limits-refresh' }));
    } else {
      api.requestBoardRender?.();
    }
    renderBar(bar, usage);
    slots.onMessage((frame) => { usage = frame.usage || null; renderBar(bar, usage); });
    api.send({ type: 'usage-limits-hello' });
  },
};
