import type { AuthStatus, DevicePoll, DeviceStart, ExportFile, GroupsUsage, ImportSummary, InstallationsStatus, Request, Response } from "../core/messages.ts";
import { parseImport } from "../core/groupState.ts";
import type { ApiErrorInfo } from "../core/types.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const statusEl = $<HTMLParagraphElement>("status");
const resultEl = $<HTMLParagraphElement>("result");
const signedOut = $<HTMLDivElement>("signedOut");
const signedIn = $<HTMLDivElement>("signedIn");
const flowEl = $<HTMLDivElement>("flow");
const userCodeEl = $<HTMLElement>("userCode");
const openGitHub = $<HTMLAnchorElement>("openGitHub");
const flowStatus = $<HTMLParagraphElement>("flowStatus");
const installStatus = $<HTMLParagraphElement>("installStatus");
const installHint = $<HTMLDivElement>("installHint");
const installLink = $<HTMLAnchorElement>("installLink");
const tokenInput = $<HTMLInputElement>("token");
const tokenResult = $<HTMLParagraphElement>("tokenResult");
const usageEl = $<HTMLParagraphElement>("usage");
const groupsResult = $<HTMLParagraphElement>("groupsResult");
const importFile = $<HTMLInputElement>("importFile");
const importConfirm = $<HTMLDivElement>("importConfirm");
const importSummary = $<HTMLParagraphElement>("importSummary");
const clearConfirm = $<HTMLDivElement>("clearConfirm");

async function send<T>(req: Request): Promise<Response<T>> {
  try {
    return (await chrome.runtime.sendMessage(req)) as Response<T>;
  } catch (e) {
    return { ok: false, error: { kind: "other", status: 0, message: e instanceof Error ? e.message : String(e) } };
  }
}

function describe(error: ApiErrorInfo): string {
  let text = error.message;
  if (error.kind === "forbidden" && error.acceptedPermissions) text += ` Required permission: ${error.acceptedPermissions}.`;
  if (error.kind === "network") text += " Check your connection.";
  return text;
}

function show(el: HTMLElement, kind: "ok" | "error", text: string): void {
  el.hidden = false;
  el.className = `result ${kind}`;
  el.textContent = text;
}

// ---- account state ----
let activeFlow: { flowId: string; timer: number | undefined; cancelled: boolean } | null = null;

function render(status: AuthStatus | null, error?: ApiErrorInfo): void {
  const inFlow = activeFlow !== null;
  signedOut.hidden = inFlow || (status?.configured ?? false);
  signedIn.hidden = inFlow || !(status?.configured ?? false);
  flowEl.hidden = !inFlow;
  if (error) statusEl.textContent = `Signed in, but GitHub rejected the credential: ${describe(error)}`;
  else if (!status || !status.configured) statusEl.textContent = "Not signed in.";
  else statusEl.textContent = `Signed in as ${status.login ?? "?"} ${status.kind === "github-app" ? "via the Repository Groups GitHub App." : "with a personal access token."}`;
}

async function refreshInstallations(): Promise<void> {
  const res = await send<InstallationsStatus>({ type: "auth.installations" });
  if (!res.ok) {
    installStatus.textContent = "";
    installHint.hidden = true;
    return;
  }
  installLink.href = res.data.installUrl;
  if (res.data.installed) {
    installHint.hidden = true;
    installStatus.textContent =
      res.data.count === 0
        ? "" // PAT: installations do not apply
        : `App installed (${res.data.count} account${res.data.count === 1 ? "" : "s"}, repositories: ${res.data.repositorySelection ?? "?"}).`;
  } else {
    installStatus.textContent = "";
    installHint.hidden = false;
  }
}

async function refresh(): Promise<void> {
  const res = await send<AuthStatus>({ type: "auth.status" });
  if (res.ok) {
    render(res.data);
    if (res.data.configured) await refreshInstallations();
  } else {
    render({ configured: true, login: null, kind: null }, res.error);
  }
}

// ---- device flow (the page owns the timing; the worker does one poll per message) ----
function stopFlow(): void {
  if (activeFlow?.timer !== undefined) clearTimeout(activeFlow.timer);
  if (activeFlow) activeFlow.cancelled = true;
  activeFlow = null;
}

async function pollLoop(flowId: string, interval: number): Promise<void> {
  const flow = activeFlow;
  if (!flow || flow.flowId !== flowId || flow.cancelled) return;
  const res = await send<DevicePoll>({ type: "auth.devicePoll", flowId });
  if (!activeFlow || activeFlow.flowId !== flowId || activeFlow.cancelled) return;
  if (!res.ok) {
    stopFlow();
    show(resultEl, "error", `Sign-in failed: ${describe(res.error)}`);
    await refresh();
    return;
  }
  if (res.data.done) {
    stopFlow();
    show(resultEl, "ok", `Signed in as ${res.data.login}.`);
    await refresh();
    return;
  }
  activeFlow.timer = window.setTimeout(() => void pollLoop(flowId, res.data.done ? interval : res.data.interval), (res.data.done ? interval : res.data.interval) * 1000);
}

$<HTMLButtonElement>("signIn").addEventListener("click", async () => {
  resultEl.hidden = true;
  const res = await send<DeviceStart>({ type: "auth.deviceStart" });
  if (!res.ok) {
    show(resultEl, "error", `Could not start sign-in: ${describe(res.error)}`);
    return;
  }
  activeFlow = { flowId: res.data.flowId, timer: undefined, cancelled: false };
  userCodeEl.textContent = res.data.userCode;
  openGitHub.href = res.data.verificationUri;
  flowStatus.textContent = `Waiting for you to approve on GitHub… (code valid for ${Math.round(res.data.expiresIn / 60)} minutes)`;
  render(null);
  activeFlow.timer = window.setTimeout(() => void pollLoop(res.data.flowId, res.data.interval), res.data.interval * 1000);
});

$<HTMLButtonElement>("copyCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(userCodeEl.textContent ?? "");
    flowStatus.textContent = "Code copied. Paste it on GitHub and approve.";
  } catch {
    flowStatus.textContent = "Select the code and copy it manually.";
  }
});

$<HTMLButtonElement>("cancelFlow").addEventListener("click", async () => {
  stopFlow();
  await refresh();
});

$<HTMLButtonElement>("signOut").addEventListener("click", async () => {
  const res = await send<AuthStatus>({ type: "auth.clear" });
  if (res.ok) show(resultEl, "ok", "Signed out. The credential was removed from this browser.");
  else show(resultEl, "error", describe(res.error));
  await refresh();
});

$<HTMLButtonElement>("recheck").addEventListener("click", () => void refreshInstallations());

// ---- advanced: PAT fallback ----
$<HTMLButtonElement>("save").addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) return show(tokenResult, "error", "Paste a token first.");
  const res = await send<AuthStatus>({ type: "auth.setToken", token });
  if (res.ok) {
    tokenInput.value = "";
    show(tokenResult, "ok", `Token verified and saved. Signed in as ${res.data.login ?? "?"}.`);
  } else {
    show(tokenResult, "error", `Token was NOT saved: ${describe(res.error)}`);
  }
  await refresh();
});

// ---- groups: usage, export, import ----
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function refreshUsage(): Promise<void> {
  const res = await send<GroupsUsage>({ type: "groups.usage" });
  if (!res.ok) {
    usageEl.textContent = `Could not read the stored groups: ${describe(res.error)}`;
    return;
  }
  const u = res.data;
  usageEl.textContent =
    u.groups === 0
      ? "No groups yet. Create one with “New group” on your GitHub repositories page."
      : `${plural(u.groups, "group", "groups")} with ${plural(u.repositories, "repository", "repositories")} (${plural(u.owners, "account", "accounts")}) · ${kb(u.bytes)} of ${kb(u.quotaBytes)} used`;
}

$<HTMLButtonElement>("exportGroups").addEventListener("click", async () => {
  const res = await send<ExportFile>({ type: "groups.export" });
  if (!res.ok) return show(groupsResult, "error", `Export failed: ${describe(res.error)}`);
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `github-repository-groups-${res.data.exportedAt.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  show(groupsResult, "ok", "Exported. Keep the file somewhere safe; import it here to restore.");
});

let pendingImport: unknown = null;
$<HTMLButtonElement>("importGroups").addEventListener("click", () => {
  importFile.value = "";
  importFile.click();
});
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  groupsResult.hidden = true;
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return show(groupsResult, "error", "That file is not valid JSON.");
  }
  const parsed = parseImport(json); // the worker checks again before saving
  if (!parsed.ok) return show(groupsResult, "error", `Cannot import: ${parsed.error}`);
  const owners = Object.entries(parsed.owners);
  const groups = owners.reduce((n, [, s]) => n + s.groups.length, 0);
  importSummary.textContent =
    `${file.name}: ${plural(groups, "group", "groups")} for ${owners.map(([o]) => o).join(", ") || "no account"}. ` +
    "The current groups of these accounts will be replaced; other accounts are left as they are.";
  pendingImport = json;
  importConfirm.hidden = false;
});
$<HTMLButtonElement>("importCancel").addEventListener("click", () => {
  pendingImport = null;
  importConfirm.hidden = true;
});
$<HTMLButtonElement>("importApply").addEventListener("click", async () => {
  if (pendingImport === null) return;
  const res = await send<ImportSummary>({ type: "groups.import", file: pendingImport });
  pendingImport = null;
  importConfirm.hidden = true;
  if (res.ok) show(groupsResult, "ok", `Imported ${plural(res.data.groups, "group", "groups")} with ${plural(res.data.repositories, "repository", "repositories")}. Reload your GitHub repositories page to see them.`);
  else show(groupsResult, "error", `Import failed: ${describe(res.error)}`);
  await refreshUsage();
});

$<HTMLButtonElement>("clearGroups").addEventListener("click", () => {
  groupsResult.hidden = true;
  clearConfirm.hidden = false;
});
$<HTMLButtonElement>("clearCancel").addEventListener("click", () => (clearConfirm.hidden = true));
$<HTMLButtonElement>("clearApply").addEventListener("click", async () => {
  clearConfirm.hidden = true;
  const res = await send<{ owners: number }>({ type: "groups.clear" });
  if (res.ok) show(groupsResult, "ok", res.data.owners === 0 ? "There were no groups to delete." : "All groups were deleted. Your repositories were not touched.");
  else show(groupsResult, "error", `Could not delete the groups: ${describe(res.error)}`);
  await refreshUsage();
});

void refresh();
void refreshUsage();
