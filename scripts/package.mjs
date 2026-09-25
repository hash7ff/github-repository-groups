// Builds the ZIP the Chrome Web Store expects: the contents of dist/, with no wrapping directory.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { name, version } = JSON.parse(readFileSync(root + "dist/manifest.json", "utf8"));
const out = `${root}build/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${version}.zip`;

mkdirSync(root + "build", { recursive: true });
rmSync(out, { force: true });
execFileSync("zip", ["-r", "-q", "-X", out, "."], { cwd: root + "dist" });
const size = execFileSync("stat", ["-c", "%s", out]).toString().trim();
console.log(`wrote ${out} (${Math.round(size / 1024)} KB)`);
console.log("upload it at https://chrome.google.com/webstore/devconsole");
