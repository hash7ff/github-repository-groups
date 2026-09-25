// esbuild: src/ -> dist/ (content script = IIFE, service worker = ESM, options = IIFE)
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

function copyStatic() {
  cpSync("manifest.json", "dist/manifest.json");
  cpSync("src/content/content.css", "dist/content.css");
  cpSync("src/options/options.html", "dist/options.html");
  cpSync("src/options/options.css", "dist/options.css");
  cpSync("icons", "dist/icons", { recursive: true });
}

const common = {
  bundle: true,
  target: "chrome120",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  outdir: "dist",
};
const configs = [
  { ...common, entryPoints: { content: "src/content/content.ts", options: "src/options/options.ts" }, format: "iife" },
  { ...common, entryPoints: { "service-worker": "src/background/service-worker.ts" }, format: "esm" },
];

copyStatic();
if (watch) {
  const ctxs = await Promise.all(configs.map((c) => context(c)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("watching... (static files are copied once; rerun for manifest/css changes)");
} else {
  await Promise.all(configs.map((c) => build(c)));
}
