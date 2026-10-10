/**
 * Browser tour of the whole product against a running stack (real API, real data).
 *   BASE_URL=http://localhost:5173 DEMO_EMAIL=… DEMO_PASSWORD=… node e2e/tour.mjs [outDir]
 * It signs in, visits every area at desktop and mobile widths, fails on console errors / failed API calls / horizontal overflow,
 * and writes full-page screenshots for visual review.
 */
import { chromium } from "playwright-core";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const EMAIL = process.env.DEMO_EMAIL ?? "demo@lotus-demo.org";
const PASSWORD = process.env.DEMO_PASSWORD ?? "DemoPassw0rd!";
const OUT = process.argv[2] ?? "screenshots";
mkdirSync(OUT, { recursive: true });

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (existsSync(path.join(root, "chromium"))) return path.join(root, "chromium");
  const dir = existsSync(root) ? readdirSync(root).find((d) => d.startsWith("chromium")) : undefined;
  return dir ? path.join(root, dir, "chrome-linux", "chrome") : undefined;
}

const problems = [];
const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });

async function session(label, viewport, dark = false) {
  const ctx = await browser.newContext({ viewport, colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|401 \(Unauthorized\)/.test(m.text())) problems.push(`[${label}] console: ${m.text().slice(0, 200)} @ ${page.url()}`); });
  page.on("pageerror", (e) => problems.push(`[${label}] exception: ${e.message.slice(0, 200)} @ ${page.url()}`));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) problems.push(`[${label}] ${r.status()} ${r.url()}`); });
  return { ctx, page };
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/projects", { timeout: 15000 });
}

async function shot(page, name) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) problems.push(`[${name}] horizontal overflow of ${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log("captured", name);
}

for (const [label, viewport, dark] of [["desktop", { width: 1440, height: 900 }, false], ["mobile", { width: 390, height: 844 }, false], ["desktop-dark", { width: 1440, height: 900 }, true]]) {
  const { ctx, page } = await session(label, viewport, dark);
  await page.goto(`${BASE}/login`);
  if (label === "desktop") await shot(page, "00-login");
  await login(page);
  await shot(page, `${label}-01-projects`);
  await page.getByRole("link", { name: /Customer Experience Study 2026/ }).first().click();
  await page.waitForURL(/\/projects\/[^/]+$/);
  const pid = page.url().split("/projects/")[1];
  const tour = [["02-overview", ""], ["03-data", "/data"], ["04-analysis", "/analysis"], ["05-qualitative", "/qualitative"], ["06-mixed", "/mixed"], ["07-visualizations", "/visualizations"],
    ["08-insights", "/insights"], ["09-assistant", "/assistant"], ["10-reports", "/reports"]];
  if (label === "desktop-dark") tour.splice(2);
  for (const [name, route] of tour) { await page.goto(`${BASE}/projects/${pid}${route}`); await shot(page, `${label}-${name}`); }
  if (label !== "desktop-dark") {
    // deep pages: dataset explorer, first analysis result, first report
    await page.goto(`${BASE}/projects/${pid}/data`);
    const ds = page.locator(`a[href*="/projects/${pid}/data/"]`).first();
    await ds.waitFor({ timeout: 8000 }).catch(() => {});
    if (await ds.count()) { await ds.click(); await page.waitForTimeout(800); await shot(page, `${label}-03b-dataset`); }
    await page.goto(`${BASE}/projects/${pid}/analysis`);
    const an = page.locator(`a[href^="/projects/${pid}/analysis/"]:not([href*="new"])`).first();
    await an.waitFor({ timeout: 8000 }).catch(() => {});
    if (await an.count()) { await an.click(); await page.waitForTimeout(1200); await shot(page, `${label}-04b-result`); }
    await page.goto(`${BASE}/projects/${pid}/analysis/new`);
    await shot(page, `${label}-04c-builder`);
    await page.goto(`${BASE}/projects/${pid}/reports`);
    const rp = page.locator(`a[href*="/projects/${pid}/reports/"]`).first();
    await rp.waitFor({ timeout: 8000 }).catch(() => {});
    if (await rp.count()) { await rp.click(); await page.waitForTimeout(1200); await shot(page, `${label}-10b-report`); }
    await page.goto(`${BASE}/settings`); await shot(page, `${label}-11-settings`);
  }
  await ctx.close();
}
await browser.close();
if (problems.length) { console.error("\nPROBLEMS:\n" + [...new Set(problems)].join("\n")); process.exit(1); }
console.log("\nTour finished with no console errors, 5xx responses or horizontal overflow.");
