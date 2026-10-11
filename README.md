# Claude usage limits

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that puts a bar above the task board showing how much of your Claude **5-hour** and **weekly** usage limits you have used, and when each resets.

- **Fill**: the share of the limit used. It turns amber at 75% and red at 90%.
- **Tick**: how far through the window you are. If the fill is past the tick, you're using the limit faster than it resets.
- **Hover** a meter for the exact reset time. **Double-click** the bar to refresh now.

The figures come from the endpoint Claude Code's own `/usage` reads (`https://api.anthropic.com/api/oauth/usage`), using the claude.ai login Claude Code already has: `~/.claude/.credentials.json` (or `$CLAUDE_CONFIG_DIR`), or the login keychain on macOS. The extension only reads the login and never refreshes it. Any running Claude session keeps it fresh. If it has expired, the bar says so. The token is sent only to `api.anthropic.com`.

It refreshes every 2 minutes by default. Change that under **Settings → Extensions → Claude usage limits**. When a fetch fails, the last figures stay up but are dimmed, and retries back off.

There's no client slot above the board, so the bar positions itself over `#grid` and gives it a `margin-top`. The board's layout measures `#grid` and packs tiles into the space that's left. The bar hides with `#grid` (Search, extension views, a maximised terminal), and turning the extension off removes its stylesheet, which hides the bar and gives the space back.

Requires host API `^1.15.0` (`board:broadcast`, client `onMessage` and `api.requestBoardRender`).

## Install

In the wrangler's Extensions tab, install from `https://github.com/goldstraw/wrangler-usage-limits.git` and consent to its one capability, `board:broadcast`.

## Develop

```
npm test
```

To try it on a dev wrangler, **copy** (don't symlink) this directory to `<AW_DATA_DIR>/extensions/usage-limits` and start the wrangler.

## Licence

Apache-2.0, see `LICENSE`.
