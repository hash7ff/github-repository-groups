import { h } from "./h.ts";
import { openDialog } from "./dialog.ts";

export type MoveTarget = { id: string; name: string; count: number };

export function openMoveDialog(opts: {
  repoName: string;
  currentId: string | null;
  groups: MoveTarget[];
  onSelect(groupId: string | null): void;
  onNewGroup(): void;
}): void {
  const dlg = openDialog(`Move ${opts.repoName} to…`);
  const item = (label: string, meta: string | null, current: boolean, onClick: () => void) =>
    h(
      "button",
      { className: `gtf-menu-item ${current ? "gtf-menu-item-current" : ""}`.trim(), type: "button", disabled: current, onClick },
      h("span", { className: "gtf-menu-item-label" }, label),
      current ? h("span", { className: "gtf-menu-item-meta" }, "current") : meta ? h("span", { className: "gtf-menu-item-meta" }, meta) : null,
    );
  const list = h("div", { className: "gtf-menu" });
  for (const g of opts.groups) {
    list.append(
      item(g.name, `${g.count}`, g.id === opts.currentId, () => {
        dlg.close();
        opts.onSelect(g.id);
      }),
    );
  }
  list.append(
    item("Ungrouped", "not in a group", opts.currentId === null, () => {
      dlg.close();
      opts.onSelect(null);
    }),
  );
  list.append(h("hr", { className: "gtf-menu-sep" }));
  list.append(
    item("New group…", null, false, () => {
      dlg.close();
      opts.onNewGroup();
    }),
  );
  dlg.body.append(list);
}
