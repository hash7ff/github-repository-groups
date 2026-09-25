// Rasterises assets/icon.svg into icons/icon{16,32,48,128}.png (plus a 512 for store artwork) using the
// developer Chrome on CDP 9224 (no native rasteriser in the dev container). Run: node scripts/render-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/usr/lib/node_modules/");
const { chromium } = require("playwright-core");

const svg = readFileSync(new URL("../assets/icon.svg", import.meta.url), "utf8");
const sizes = [16, 32, 48, 128, 512];

const browser = await chromium.connectOverCDP("http://localhost:9224");
const page = await browser.contexts()[0].newPage();
for (const size of sizes) {
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
  await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(html), { waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: size, height: size });
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size }, timeout: 20000 });
  const out = new URL(`../${size === 512 ? "assets/icon512.png" : `icons/icon${size}.png`}`, import.meta.url);
  writeFileSync(out, buf);
  console.log("wrote", out.pathname, buf.length, "bytes");
}
await page.close();
await browser.close();
