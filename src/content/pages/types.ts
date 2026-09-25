// One adapter per kind of GitHub page we support. Everything else in the extension is page-independent:
// the adapter is the only place that knows GitHub's DOM or its navigation signals.

export type PageKind = "user" | "org";
export type PageContext = { owner: string; kind: PageKind };

export type PageAdapter = {
  readonly kind: PageKind;
  /** The owner whose repositories this URL shows, or null when this adapter does not handle the URL. */
  detect(href: string): PageContext | null;
  /**
   * The element our view is inserted before, and which is hidden while the grouped view is shown.
   * Returns null while the page has not rendered it yet. On React pages this element is REPLACED on every
   * re-render, so callers must re-read it rather than hold on to it.
   */
  anchor(): HTMLElement | null;
  /** Make GitHub's own list visible again (teardown). */
  restore(): void;
  /** Subtree to watch for re-renders; null means "watch the body's direct children only". */
  observeTarget(): Element | null;
};
