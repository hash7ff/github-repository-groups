const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const dtf = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const dtfYear = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

/** GitHub-like relative time: "just now", "23 minutes ago", "yesterday", "last week", "on Mar 3" / "on Mar 3, 2024". */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.round((now - t) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hours = Math.round(min / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  if (days < 30) return rtf.format(-Math.round(days / 7), "week");
  const d = new Date(t);
  return `on ${new Date(now).getFullYear() === d.getFullYear() ? dtf.format(d) : dtfYear.format(d)}`;
}
