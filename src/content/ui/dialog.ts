// Minimal modal built on <dialog>. Appended to <body> so GitHub's layout cannot clip it; removed on close.
import { h } from "./h.ts";

export type Dialog = { el: HTMLDialogElement; body: HTMLElement; close(): void };

const openDialogs = new Set<HTMLDialogElement>();
/** Called when the view is torn down (Turbo navigation): a dialog must never outlive the page it belongs to. */
export function closeAllDialogs(): void {
  for (const d of [...openDialogs]) {
    if (d.open) d.close();
    d.remove();
  }
  openDialogs.clear();
}

export function openDialog(title: string, opts: { className?: string } = {}): Dialog {
  const body = h("div", { className: "gtf-dialog-body" });
  const el = h(
    "dialog",
    { className: `gtf-dialog ${opts.className ?? ""}`.trim() },
    h(
      "div",
      { className: "gtf-dialog-head" },
      h("h2", { className: "gtf-dialog-title" }, title),
      h("button", { className: "gtf-btn gtf-dialog-close", type: "button", ariaLabel: "Close", onClick: () => close() }, "×"),
    ),
    body,
  );
  const close = () => {
    if (el.open) el.close();
  };
  openDialogs.add(el);
  el.addEventListener("close", () => {
    openDialogs.delete(el);
    el.remove();
  });
  // click on the backdrop closes
  el.addEventListener("click", (e) => {
    if (e.target === el) close();
  });
  document.body.append(el);
  el.showModal();
  return { el, body, close };
}
