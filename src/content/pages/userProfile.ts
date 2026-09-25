// github.com/<user>?tab=repositories — server-rendered, Turbo navigation, stable anchor id.
import type { PageAdapter, PageContext } from "./types.ts";

const ANCHOR_ID = "user-repositories-list";

export function detectUserRepositoriesPage(href: string): PageContext | null {
  const url = new URL(href);
  if (url.hostname !== "github.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  if (url.searchParams.get("tab") !== "repositories") return null;
  const owner = segments[0];
  if (!owner || owner.startsWith("@")) return null;
  return { owner, kind: "user" };
}

export const userProfileAdapter: PageAdapter = {
  kind: "user",
  detect: detectUserRepositoriesPage,
  anchor: () => document.getElementById(ANCHOR_ID),
  restore() {
    const el = document.getElementById(ANCHOR_ID);
    if (el) el.hidden = false;
  },
  observeTarget: () => document.querySelector("turbo-frame#user-profile-frame"),
};
