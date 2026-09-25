#!/usr/bin/env bash
# Regenerate src/core/languageColors.ts from GitHub's linguist data.
set -euo pipefail
cd "$(dirname "$0")/.."
curl -sSL "https://raw.githubusercontent.com/github-linguist/linguist/main/lib/linguist/languages.yml" -o /tmp/languages.yml
python3 - <<'PY'
import re, json, pathlib, datetime
text = open("/tmp/languages.yml", encoding="utf-8").read()
colors = {}
for entry in re.split(r"\n(?=\S)", text):
    m = re.match(r'^(?:"([^"]+)"|([^:\n]+)):', entry)
    if not m:
        continue
    c = re.search(r'^\s+color:\s*"([#0-9a-fA-F]+)"', entry, re.M)
    if c:
        colors[(m.group(1) or m.group(2)).strip()] = c.group(1)
items = "".join(f"  {json.dumps(k)}: {json.dumps(v)},\n" for k, v in sorted(colors.items()))
pathlib.Path("src/core/languageColors.ts").write_text(
"""// Generated from github-linguist/linguist `lib/linguist/languages.yml` (fetched %s): language name -> colour.
// Regenerate with scripts/generate-language-colors.sh. %d languages carry a colour; others fall back to a neutral dot.

const LANGUAGE_COLORS: Record<string, string> = {
%s};

const BY_LOWER = new Map(Object.entries(LANGUAGE_COLORS).map(([name, colour]) => [name.toLowerCase(), colour]));

export function languageColor(language: string | null): string | null {
  if (!language) return null;
  return BY_LOWER.get(language.toLowerCase()) ?? null;
}
""" % (datetime.date.today().isoformat(), len(colors), items))
print("wrote src/core/languageColors.ts with", len(colors), "languages")
PY
