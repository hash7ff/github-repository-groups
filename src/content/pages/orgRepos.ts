// github.com/orgs/<org>/repositories — a React app: soft navigation, no stable ids, and the list container is
// replaced on every render (measured 2026-09-04). We therefore look the anchor up fresh every time and never
// cache it. The container carries a React-generated id whose suffix is stable, and its screen-reader heading
// ("Repositories list") gives a second, text-based route to the same element.
import type { PageAdapter, PageContext } from "./types.ts";

export function detectOrgRepositoriesPage(href: string): PageContext | null {
  const url = new URL(href);
  if (url.hostname !== "github.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 3 || segments[0] !== "orgs" || segments[2] !== "repositories") return null;
  const owner = segments[1];
  return owner ? { owner, kind: "org" } : null;
}

/**
 * The element our view goes in front of, and which we hide.
 *
 * GitHub wraps the list in a bordered box (`div[data-listview-repos-list]`) that also holds the repository count
 * and the density switch. We anchor on that box rather than on the `ListView` container inside it: our view then
 * sits outside GitHub's border instead of inside it, and hiding the box takes its border with it, so we never
 * have to override GitHub's styles. The data attribute is used because the class on the same element carries a
 * build hash (`ReposList-module__ReposListContainer__BrFiJ`) that changes on every GitHub deploy.
 */
function listContainer(): HTMLElement | null {
  const box = document.querySelector<HTMLElement>("[data-listview-repos-list]");
  if (box) return box;
  // Fallbacks, in case that attribute disappears: the list container itself (works, but sits inside GitHub's
  // border), then the visually hidden heading GitHub renders above the list.
  const byId = document.querySelector<HTMLElement>('[id$="-list-view-container"]');
  if (byId) return byId;
  for (const h of document.querySelectorAll("h2")) {
    if (h.textContent?.trim() === "Repositories list") {
      const parent = h.closest<HTMLElement>("div");
      if (parent) return parent;
    }
  }
  return null;
}

export const orgReposAdapter: PageAdapter = {
  kind: "org",
  detect: detectOrgRepositoriesPage,
  anchor: listContainer,
  restore() {
    const el = listContainer();
    if (el) el.hidden = false;
  },
  observeTarget: () => document.querySelector("main"),
};
