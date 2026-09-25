# Repository Groups for GitHub

Chrome MV3 extension that shows the repositories on a GitHub Repositories tab in collapsible groups. Groups are kept
in the browser (`chrome.storage.sync`); nothing is ever written to GitHub.

## Invariants (do not break)

- **Read-only towards GitHub.** The API wrapper (`src/background/github-api.ts`) allows `GET` only; the only other
  request is the OAuth device flow to github.com for sign-in and token refresh.
- **The credential never reaches the page.** The token lives in `chrome.storage.local` with access restricted to
  trusted contexts, and only the service worker reads it. Never pass it to the content script, the DOM or logs
  (`scripts/check-token-isolation.sh` checks the build).
- **GitHub's own list can always come back.** The "Original" switch restores it, and any error leaves it in place.

## Layout

- `src/core/` — pure logic (no `chrome.*`, no DOM) with `node:test` tests next to it.
- `src/background/` — service worker: GitHub API, storage, the only place that holds the credential.
- `src/content/` — content script and UI injected into the Repositories tab (`src/content/pages/` detects pages).
- `src/options/` — settings page (sign-in, groups export/import/delete, how to stop using the extension).
- `site/` — GitHub Pages (home and privacy policy). The store listing links to these URLs; keep them stable.

## Commands

- `npm run check` — typecheck, unit tests, build, token-isolation check. Run before every commit.
- `npm run package` — the store ZIP in `build/`.
