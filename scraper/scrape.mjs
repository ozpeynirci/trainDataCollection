// TCDD "Trenim Nerede" sayfasını sıradan bir ziyaretçi gibi açar; o an yolda olan seferler için
// birkaç istasyon sorgular, GİTTİ / beklenen saat sınırından konum ve rötarı bulur.
// Sonuç siteye canlı durum olarak gönderilir (POST /api/push). Kalıcı kayıt tutulmaz.
//
//   node scrape.mjs            # bir kez çalış (Actions saatte bir çağırır)
//   node scrape.mjs --dry      # sadece ekrana yaz, gönderme/kaydetme
// Ortam: SITE_URL, PUSH_SECRET, TCDD_URL (test için), CHROME_PATH (test için)

import { chromium } from "playwright-core";
import { existsSync as fileExists } from "node:fs";
import { activeServices, queryableRange, estimateIndex, findBoundary, classify, schedAt, istanbulNow, toMin } from "./logic.mjs";

const PAGE = process.env.TCDD_URL || "https://ebilet.tcddtasimacilik.gov.tr/trenim-nerede";
const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");
const SECRET = process.env.PUSH_SECRET || "";
const DRY = process.argv.includes("--dry");
const MIN_GAP_MS = 2000;          // TCDD'ye iki sorgu arası en az bu kadar
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function previousStatus() {
  if (SITE) try {
    const r = await fetch(SITE + "/api/status", { headers: { "cache-control": "no-cache" } });
    if (r.ok) { const j = await r.json(); if (j && j.trains) return j.trains; }
  } catch {}
  return {};
}

// ---- TCDD sayfası ----
let page, lastQueryAt = 0;
const cache = new Map();   // "İSTASYON|mod" -> { trenNo: [hücreler] }
async function stationRows(browser, name, mode) {
  const key = `${name}|${mode}`;
  if (cache.has(key)) return cache.get(key);
  const wait = MIN_GAP_MS - (Date.now() - lastQueryAt); if (wait > 0) await sleep(wait);
  lastQueryAt = Date.now();
  if (!page) {
    page = await browser.newPage({ locale: "tr-TR", timezoneId: "Europe/Istanbul" });
    page.setDefaultTimeout(25000);
    // görsel, font ve medya indirme: sayfa daha hızlı açılsın, TCDD'ye daha az yük
    await page.route("**/*", r => ["image", "font", "media"].includes(r.request().resourceType()) ? r.abort() : r.continue());
  }
  const term = name.replace(/^İZMİR \(BASMANE\)$/, "BASMANE").replace(/\s*A\.ÇETİNKAYA$/, "").replace(/ GAR$/, "");
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sorgula" }).waitFor();
  const box = page.locator("input.dropdown-toggle").first();
  await box.click(); await box.press("Control+A"); await box.pressSequentially(term, { delay: 40 });
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const option = page.locator(".dropdown-menu.show button.dropdown-item.station").filter({ hasText: new RegExp(`(^|\\s)${esc}\\s*$`) }).first();
  await option.waitFor(); await option.click();
  await page.getByRole("button", { name: mode }).click();
  await page.getByRole("button", { name: "Sorgula" }).click();
  await page.locator("table.b-table").first().waitFor();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
  // tüm satırlar tek sayfada olsun
  const sel = page.locator("select.custom-select:visible").first();
  if (await sel.count()) { await sel.selectOption("50").catch(() => {}); await page.waitForTimeout(400); }
  const rows = await page.evaluate(() => {
    const out = {};
    for (const tr of document.querySelectorAll("table.b-table tbody tr")) {
      const c = [...tr.cells].map(x => x.textContent.replace(/\s+/g, " ").trim());
      if (c.length >= 5 && /^\d+$/.test(c[0])) out[c[0]] = c;
    }
    return out;
  });
  cache.set(key, rows);
  log(`  ${name} (${mode}): ${Object.keys(rows).length} tren`);
  return rows;
}

function makeQuery(browser, T) {
  return async i => {
    const mode = i === T.LAST ? "Gelen Seferler" : "Giden Seferler";
    let rows;
    try { rows = await stationRows(browser, T.stops[i].tcdd, mode); }
    catch (e) {
      log(`  ${T.stops[i].tcdd}: hata (${e.message.split("\n")[0]})`);
      try { await page?.close(); } catch {} page = null;
      return { kind: "unknown" };
    }
    const row = rows[T.no];
    if (!row) return { kind: "absent" };
    const rowTime = (row[3].match(/\d{1,2}:\d{2}/) || [""])[0].padStart(5, "0");
    if (rowTime !== schedAt(T, i)) { log(`    ${T.no}@${T.stops[i].tcdd}: tutarsız satır ${rowTime}`); return { kind: "unknown" }; }
    const c = classify(row[4]);
    // Beklenen saat çoktan geçmişse tren o istasyonu geçmiştir (TCDD bazen "GİTTİ" yazmayı unutuyor)
    if (c.kind === "expected") {
      const { min } = istanbulNow(new Date());
      let diff = toMin(c.time) - min; if (diff < -720) diff += 1440; if (diff > 720) diff -= 1440;
      if (diff < -10) { log(`    ${T.no}@${T.stops[i].tcdd}: "${row[4]}" geçmişte, GİTTİ sayıldı`); return { kind: "passed", inferred: true }; }
    }
    log(`    ${T.no}@${T.stops[i].tcdd}: "${row[4]}" -> ${c.kind}`);
    return c;
  };
}

// ---- ana akış ----
const now = new Date(), nowIso = now.toISOString();
const prev = await previousStatus();
const services = activeServices(now, prev);
log(`${services.length} aktif sefer:`, services.map(s => `${s.T.no}/${s.service}`).join(" "));
if (!services.length) process.exit(0);

// Bilgisayarda kurulu Chrome/Edge kullanılır; ayrıca tarayıcı indirmeye gerek yok
const CHROME = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p => fileExists(p));
const browser = await chromium.launch({ args: ["--no-sandbox"], ...(CHROME ? { executablePath: CHROME } : {}) });
const statuses = [];
try {
  for (const { T, service, elapsed, delay } of services) {
    const { lo, hi } = queryableRange(T, service, now);
    if (lo === null) { log(`${T.no}/${service}: bugün listelenen istasyonu yok, atlandı`); continue; }
    const start = Math.max(lo, Math.min(hi, estimateIndex(T, elapsed, delay)));
    log(`${T.no} ${T.name} ${T.from}→${T.to} [${service}] başlangıç: ${T.stops[start].tcdd}`);
    const r = await findBoundary(T, makeQuery(browser, T), start, lo, hi, 5);
    const p = prev[`${T.no}|${service}`];
    const s = {
      trainNo: T.no, slug: T.slug, service, updatedAt: nowIso, ok: r.ok,
      lastPassedIdx: r.lastPassedIdx, nextIdx: r.nextIdx,
      lastPassed: r.lastPassedIdx != null ? T.stops[r.lastPassedIdx].tcdd : null,
      next: r.nextIdx != null ? T.stops[r.nextIdx].tcdd : null,
      nextExpected: r.nextExpected, delayMin: r.delayMin,
      lastDelay: Number.isFinite(r.delayMin) ? r.delayMin : (p && Number.isFinite(p.lastDelay) ? p.lastDelay : null),
      arrived: r.arrived, queries: r.queries,
    };
    log(`  -> geçti: ${s.lastPassed ?? "-"} | sıradaki: ${s.next ?? "-"} ${s.nextExpected ?? ""} | rötar: ${s.delayMin ?? "?"} | ${r.queries} sorgu`);
    if (r.ok) statuses.push(s);
  }
} finally { await browser.close(); }

if (DRY) { log("dry-run: gönderilmedi"); process.exit(0); }

// canlı durum -> site
if (SITE && SECRET && statuses.length) {
  try {
    const res = await fetch(SITE + "/api/push", { method: "POST", headers: { "content-type": "application/json", "x-push-secret": SECRET }, body: JSON.stringify({ statuses }) });
    log("siteye gönderildi:", res.status);
  } catch (e) { log("siteye gönderilemedi:", e.message); }
}
log(`${statuses.length} sefer durumu gönderildi`);
