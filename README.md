# Repository Groups for GitHub

A Chrome extension that adds collapsible groups to the Repositories tab of your GitHub profile
(`github.com/<you>?tab=repositories`), GitLab-group style. GitHub has no way to group repositories; this is a small,
careful workaround.

> **Chrome Web Store:** https://chromewebstore.google.com/detail/gmgodfjbahmhgnpmijnifcibicpdelop
> Website: https://hash7ff.github.io/github-repository-groups/

## How it works

```
                    reads the repository list (read-only REST API)
  github.com   <────────────────────────────────────────────────────  service worker ──── chrome.storage.local
  (your Repositories tab)                                                   │               your GitHub credential
        ▲                                                                   │               (never shown to the page)
        │ shows the grouped view                                            │
   content script  ── asks for repositories and groups ──────────────────▶ │
                                                                            └──────────── chrome.storage.sync
                                                                                            your groups: names, and which
                                                                                            repository ids are in them
```

- **Nothing is written to GitHub.** The extension only ever sends `GET` requests: `/user`, `/user/repos`,
  `/orgs/{org}/repos` and `/user/installations`. There is no write method in the code at all.
- **Groups are stored in your browser**, in Chrome's sync storage for this extension. With Chrome sync on they follow
  you to other computers signed in to the same Google account, like bookmarks. With sync off they stay on this computer.
  Groups refer to repositories by their numeric id, so renaming a repository does not take it out of its group.
- **The repository list comes from GitHub's API, not from the page.** Reading GitHub's HTML would avoid the setup step
  below, but it breaks whenever GitHub redesigns the page. The API is versioned and documented.

## Why a GitHub App, and how to remove it

GitHub lets an app list your **private** repositories only after you install it on them. That is the one setup step:

1. In the extension's settings, click **Sign in with GitHub**, enter the short code on `github.com/login/device` and
   approve *Repository Groups*.
2. Install the *Repository Groups* app on your repositories (*All repositories*, or only the ones you want to organise).

The app asks for **Metadata: Read-only** and nothing else. It cannot read your code and cannot change anything.

To stop using it, nothing is left behind after these four steps:

1. Extension settings → **Delete all groups…** (also clears them from Chrome sync on your other computers).
2. Extension settings → **Sign out** (the credential is removed from the browser).
3. GitHub → Settings → Applications → **Installed GitHub Apps** → Repository Groups → Configure → **Uninstall**,
   and **Authorized GitHub Apps** → Repository Groups → **Revoke**.
   For an organization, an owner uninstalls it under the organization's Settings → Third-party Access → GitHub Apps.
4. Remove the extension from `chrome://extensions`.

## Features

- **Grouped view** on your Repositories tab, with a `Grouped | Original` switch that brings GitHub's own list back at
  any time. The original list is also left in place whenever the extension has an error.
- **Collapse and expand** groups; the state is remembered per browser. Repositories in no group appear under **Ungrouped**.
- **New group** (empty, or with repositories picked from a list), **Move to…** on every repository,
  **Add repositories…** in bulk, **Rename** (renaming onto an existing name merges the two), **Delete**
  (the repositories go back to Ungrouped; nothing is deleted on GitHub).
- **GitHub's own controls keep working**: Find, Type, Language and Sort above the list narrow and order the grouped
  view too.
- **Organizations**: the same view on `github.com/orgs/<org>/repositories` for organizations where the app is installed.
- **Export / import** your groups as a JSON file, for backups or for moving to a browser without Chrome sync.
- A fine-grained personal access token (Metadata: Read-only) works as an advanced alternative to signing in.

## Privacy and security

- The credential lives in `chrome.storage.local`, restricted to the extension's own pages and service worker; the
  content script on github.com cannot read it (also checked at build time). Device-flow tokens are refreshed with the
  public client id alone; there is no client secret anywhere.
- Groups (group names and repository ids) live in `chrome.storage.sync`. They are never sent to us. With Chrome sync
  on, Google keeps them as part of your Chrome sync data.
- No analytics, no tracking, no servers of our own.
- Full policy: https://hash7ff.github.io/github-repository-groups/privacy.html

## Limits

- Chrome sync gives an extension about 100 KB. That is room for several thousand grouped repositories; the settings
  page shows how much is used.
- Groups follow you through Chrome sync only. Another browser needs an export and an import.
- For an organization, the app must be installed on that organization. If you are not an owner, GitHub turns the
  install button into a request that an owner approves.

## Build from source

```
npm install
npm run check      # typecheck + unit tests + build + token-isolation check
```

Then open `chrome://extensions`, enable *Developer mode*, choose *Load unpacked* and select the `dist/` folder.

## History

Versions up to 0.4 stored each repository's group as a GitHub topic (`topic-groups-*`). Topics are public labels meant
for discovery, so using them as private folders put bookkeeping tags on public repositories and required write access
to repositories. Since 0.5.0 nothing is written to GitHub; topics added by older versions are left untouched and can
be removed on GitHub if you no longer want them.

## License

MIT © 2026 HASH7FF LLC
