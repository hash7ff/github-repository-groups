import type { PageAdapter, PageContext } from "./types.ts";
import { userProfileAdapter } from "./userProfile.ts";
import { orgReposAdapter } from "./orgRepos.ts";

export const ADAPTERS: readonly PageAdapter[] = [userProfileAdapter, orgReposAdapter];

export function pickAdapter(href: string): { adapter: PageAdapter; ctx: PageContext } | null {
  for (const adapter of ADAPTERS) {
    const ctx = adapter.detect(href);
    if (ctx) return { adapter, ctx };
  }
  return null;
}

export type { PageAdapter, PageContext, PageKind } from "./types.ts";
