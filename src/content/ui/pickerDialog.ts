import { h, clear } from "./h.ts";
import { openDialog } from "./dialog.ts";
import { byName } from "../../core/grouping.ts";
import { checkGroupName, type GroupDef } from "../../core/groupState.ts";
import type { RepoSummary } from "../../core/types.ts";

function repoPicker(opts: { repos: readonly RepoSummary[]; selected: Set<string>; onChange(): void }): { filter: HTMLInputElement; list: HTMLElement; render(): void } {
  const filter = h("input", { className: "gtf-input", type: "search", placeholder: "Filter repositories…", ariaLabel: "Filter repositories" });
  const list = h("div", { className: "gtf-picker" });
  const sorted = [...opts.repos].sort(byName);
  const render = () => {
    clear(list);
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    for (const r of sorted) {
      if (q && !r.name.toLowerCase().includes(q)) continue;
      shown++;
      const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = opts.selected.has(r.name);
      cb.addEventListener("change", () => {
        if (cb.checked) opts.selected.add(r.name);
        else opts.selected.delete(r.name);
        opts.onChange();
      });
      list.append(
        h(
          "label",
          { className: "gtf-picker-item" },
          cb,
          h("span", { className: "gtf-picker-name" }, r.name),
          r.private ? h("span", { className: "gtf-label" }, "Private") : null,
          r.archived ? h("span", { className: "gtf-label gtf-label-attention" }, "Archived") : null,
        ),
      );
    }
    if (shown === 0) list.append(h("p", { className: "gtf-empty" }, "No repositories match."));
  };
  filter.addEventListener("input", render);
  return { filter, list, render };
}

function selectAllRow(selected: Set<string>, repos: readonly RepoSummary[], rerender: () => void): HTMLElement {
  return h(
    "div",
    { className: "gtf-picker-tools" },
    h("button", { className: "gtf-link-btn", type: "button", onClick: () => { for (const r of repos) selected.add(r.name); rerender(); } }, "Select all"),
    h("button", { className: "gtf-link-btn", type: "button", onClick: () => { selected.clear(); rerender(); } }, "Clear"),
  );
}

/** Create a group (empty, or with repositories). If the name matches an existing group, the chosen repositories move into it. */
export function openNewGroupDialog(opts: {
  repos: readonly RepoSummary[];
  preselected: readonly string[];
  groups: readonly GroupDef[];
  onCreate(name: string, repoNames: string[]): Promise<void>;
}): void {
  const dlg = openDialog("New group", { className: "gtf-dialog-wide" });
  const selected = new Set(opts.preselected);

  const nameInput = h("input", { className: "gtf-input", type: "text", placeholder: "e.g. Platform", ariaLabel: "Group name" });
  const hint = h("p", { className: "gtf-preview" });
  const count = h("span", { className: "gtf-muted" });
  const confirm = h("button", { className: "gtf-btn gtf-btn-primary", type: "button" }, "Create group");
  const error = h("p", { className: "gtf-error", hidden: true });

  const picker = repoPicker({ repos: opts.repos, selected, onChange: () => update() });
  const update = () => {
    const res = checkGroupName(nameInput.value, opts.groups);
    const existing = res.ok ? res.existing : null;
    if (nameInput.value.trim() === "") {
      hint.textContent = "";
      hint.className = "gtf-preview";
    } else if (!res.ok) {
      hint.textContent = res.error;
      hint.className = "gtf-preview gtf-error";
    } else {
      hint.textContent = existing ? `"${existing.name}" already exists: the repositories below move into it.` : "";
      hint.className = "gtf-preview";
    }
    confirm.textContent = existing ? `Move to ${existing.name}` : "Create group";
    count.textContent = `${selected.size} repositor${selected.size === 1 ? "y" : "ies"} selected`;
    // A new group may start empty; moving into an existing one needs at least one repository.
    confirm.disabled = !res.ok || (existing !== null && selected.size === 0);
  };
  const rerender = () => {
    picker.render();
    update();
  };

  nameInput.addEventListener("input", update);
  confirm.addEventListener("click", async () => {
    const res = checkGroupName(nameInput.value, opts.groups);
    if (!res.ok) return;
    confirm.disabled = true;
    const label = confirm.textContent;
    confirm.textContent = "Saving…";
    error.hidden = true;
    try {
      await opts.onCreate(res.name, [...selected]);
      dlg.close();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
      error.hidden = false;
      confirm.disabled = false;
      confirm.textContent = label;
    }
  });

  dlg.body.append(
    h("label", { className: "gtf-field" }, h("span", { className: "gtf-field-label" }, "Group name"), nameInput),
    hint,
    h("div", { className: "gtf-field-label" }, "Repositories"),
    picker.filter,
    selectAllRow(selected, opts.repos, rerender),
    picker.list,
    h("div", { className: "gtf-dialog-foot" }, count, h("span", { className: "gtf-spacer" }), h("button", { className: "gtf-btn", type: "button", onClick: () => dlg.close() }, "Cancel"), confirm),
    error,
  );
  picker.render();
  update();
  nameInput.focus();
}

/** Move several repositories into an existing group in one go. */
export function openAddRepositoriesDialog(opts: {
  groupName: string;
  repos: readonly RepoSummary[];
  memberNames: ReadonlySet<string>;
  onAdd(repoNames: string[]): Promise<void>;
}): void {
  const dlg = openDialog(`Add repositories to ${opts.groupName}`, { className: "gtf-dialog-wide" });
  const selected = new Set<string>();
  // Members are already in the group; removing one is "Move to… → Ungrouped" on its row.
  const available = opts.repos.filter((r) => !opts.memberNames.has(r.name));

  const count = h("span", { className: "gtf-muted" });
  const confirm = h("button", { className: "gtf-btn gtf-btn-primary", type: "button" }, "Add");
  const error = h("p", { className: "gtf-error", hidden: true });
  const picker = repoPicker({ repos: available, selected, onChange: () => update() });
  const update = () => {
    count.textContent = `${selected.size} repositor${selected.size === 1 ? "y" : "ies"} selected`;
    confirm.disabled = selected.size === 0;
  };
  const rerender = () => {
    picker.render();
    update();
  };

  confirm.addEventListener("click", async () => {
    if (selected.size === 0) return;
    confirm.disabled = true;
    confirm.textContent = "Moving…";
    error.hidden = true;
    try {
      await opts.onAdd([...selected]);
      dlg.close();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
      error.hidden = false;
      confirm.disabled = false;
      confirm.textContent = "Add";
    }
  });

  dlg.body.append(
    available.length === 0
      ? h("p", { className: "gtf-empty" }, "Every repository is already in this group.")
      : h("p", { className: "gtf-muted" }, "Repositories already in this group are not listed. To take one out, use “Move to…” on its row."),
    picker.filter,
    selectAllRow(selected, available, rerender),
    picker.list,
    h("div", { className: "gtf-dialog-foot" }, count, h("span", { className: "gtf-spacer" }), h("button", { className: "gtf-btn", type: "button", onClick: () => dlg.close() }, "Cancel"), confirm),
    error,
  );
  picker.render();
  update();
}
