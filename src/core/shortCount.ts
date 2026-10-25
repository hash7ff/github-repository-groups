/** 1234 → "1.2k", as GitHub abbreviates star and fork counts in its repository list. */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
