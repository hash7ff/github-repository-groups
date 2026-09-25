import { h } from "./h.ts";
import { openDialog } from "./dialog.ts";
import { checkGroupName, type GroupDef } from "../../core/groupState.ts";

const plural = (n: number) => `${n} repositor${n === 1 ? "y" : "ies"}`;

export function openGroupMenu(opts: { name: string; onAdd(): void; onRename(): void; onDelete(): void }): void {
  const dlg = openDialog(opts.name);
  const item = (label: string, danger: boolean, onClick: () => void) =>
    h("button", { className: `gtf-menu-item ${danger ? "gtf-menu-item-danger" : ""}`.trim(), type: "button", onClick: () => { dlg.close(); onClick(); } }, h("span", { className: "gtf-menu-item-label" }, label));
  dlg.body.append(
    h("div", { className: "gtf-menu" }, item("Add repositories…", false, opts.onAdd), item("Rename group…", false, opts.onRename), item("Delete group…", true, opts.onDelete)),
  );
}

/** Renaming onto another group's name merges into that group (its repositories move there, this group is removed). */
export function openRenameDialog(opts: {
  name: string;
  id: string;
  count: number;
  groups: readonly GroupDef[];
  onRename(newName: string): Promise<void>;
}): void {
  const dlg = openDialog(`Rename ${opts.name}`);
  const input = h("input", { className: "gtf-input", type: "text", ariaLabel: "New group name" }) as HTMLInputElement;
  input.value = opts.name;
  const summary = h("p", {});
  const error = h("p", { className: "gtf-error", hidden: true });
  const btn = h("button", { className: "gtf-btn gtf-btn-primary", type: "button" }, "Rename");

  const update = () => {
    const res = checkGroupName(input.value, opts.groups, opts.id);
    if (!res.ok) {
      summary.textContent = res.error;
      summary.className = "gtf-error";
      btn.textContent = "Rename";
      btn.disabled = true;
      return;
    }
    summary.className = "";
    if (res.name === opts.name) {
      summary.textContent = "";
      btn.textContent = "Rename";
      btn.disabled = true;
      return;
    }
    summary.textContent = res.existing
      ? `"${res.existing.name}" already exists: ${plural(opts.count)} will move into it and "${opts.name}" will be removed.`
      : `Rename "${opts.name}" to "${res.name}".`;
    btn.textContent = res.existing ? `Merge into ${res.existing.name}` : "Rename";
    btn.disabled = false;
  };
  input.addEventListener("input", update);
  btn.addEventListener("click", async () => {
    const res = checkGroupName(input.value, opts.groups, opts.id);
    if (!res.ok) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Saving…";
    try {
      await opts.onRename(res.name);
      dlg.close();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
      error.hidden = false;
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  dlg.body.append(
    h("label", { className: "gtf-field" }, h("span", { className: "gtf-field-label" }, "New group name"), input),
    summary,
    h("div", { className: "gtf-dialog-foot" }, h("span", { className: "gtf-spacer" }), h("button", { className: "gtf-btn", type: "button", onClick: () => dlg.close() }, "Cancel"), btn),
    error,
  );
  update();
  input.focus();
  input.select();
}

export function openDeleteDialog(opts: { name: string; count: number; onDelete(): Promise<void> }): void {
  const dlg = openDialog(`Delete group "${opts.name}"?`);
  const error = h("p", { className: "gtf-error", hidden: true });
  const btn = h("button", { className: "gtf-btn gtf-btn-danger", type: "button" }, "Delete group");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Deleting…";
    try {
      await opts.onDelete();
      dlg.close();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
      error.hidden = false;
      btn.disabled = false;
      btn.textContent = "Delete group";
    }
  });
  dlg.body.append(
    h("p", {}, opts.count === 0 ? "The group is empty." : `${plural(opts.count)} will become Ungrouped.`),
    h("p", {}, h("strong", {}, "Your repositories are not touched."), " Only the group is removed from this browser; nothing on GitHub changes."),
    h("div", { className: "gtf-dialog-foot" }, h("span", { className: "gtf-spacer" }), h("button", { className: "gtf-btn", type: "button", onClick: () => dlg.close() }, "Cancel"), btn),
    error,
  );
}
