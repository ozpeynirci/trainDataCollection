// Admin istatistikleri. "x-admin-key" başlığı ADMIN_PASSWORD ile eşleşmeli.
// Biten günler bir kez toplanıp "rollup/<gün>" olarak saklanır; bugünün olayları her istekte sayılır.
import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const inc = (o, k, n = 1) => { if (k == null || k === "") return; o[k] = (o[k] || 0) + n; };

async function aggregateDay(store, day) {
  const agg = { day, visits: 0, uniques: 0, trains: {}, searches: {}, devices: {}, countries: {}, hours: Array(24).fill(0), refs: {}, events: 0 };
  const seen = new Set();
  const { blobs } = await store.list({ prefix: `ev/${day}/` });
  const recs = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" }).catch(() => null)));
  for (const r of recs) {
    if (!r) continue;
    agg.events++;
    if (r.v) seen.add(r.v);
    if (r.t === "visit") { agg.visits++; inc(agg.devices, r.d); inc(agg.countries, r.c); inc(agg.refs, r.r); if (r.h >= 0 && r.h < 24) agg.hours[r.h]++; }
    else if (r.t === "train") inc(agg.trains, r.s);
    else if (r.t === "search") inc(agg.searches, r.q);
  }
  agg.uniques = seen.size;
  return agg;
}

export default async (req) => {
  const pass = Netlify.env.get("ADMIN_PASSWORD");
  if (!pass) return new Response("ADMIN_PASSWORD tanımlı değil", { status: 503 });
  let given = req.headers.get("x-admin-key") || "";
  try { given = decodeURIComponent(given); } catch {}
  if (!same(given.trim(), pass.trim())) return new Response("Yetkisiz", { status: 401 });
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days") || "7", 10) || 7));
  const store = getStore("stats");
  const today = new Date(Date.now() + 180 * 60000).toISOString().slice(0, 10);
  const list = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - i); list.push(d.toISOString().slice(0, 10)); }

  const out = [];
  for (const day of list) {
    if (day === today) { out.push(await aggregateDay(store, day)); continue; }
    let r = await store.get(`rollup/${day}`, { type: "json" });
    if (!r) {
      r = await aggregateDay(store, day);
      await store.setJSON(`rollup/${day}`, r);
      // toplanan günün ham olaylarını sil (depo küçük kalsın)
      const { blobs } = await store.list({ prefix: `ev/${day}/` });
      await Promise.all(blobs.map(b => store.delete(b.key).catch(() => {})));
    }
    out.push(r);
  }
  return Response.json({ today, days: out }, { headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/stats" };
