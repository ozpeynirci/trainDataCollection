// Admin istatistikleri. "x-admin-key" başlığı ADMIN_PASSWORD ile eşleşmeli.
// Biten günler bir kez toplanıp "rollup" tablosuna yazılır ve ham olayları silinir.
import { db, same, trDay } from "../../lib/db.js";

const inc = (o, k, n = 1) => { if (k == null || k === "") return; o[k] = (o[k] || 0) + n; };
async function aggregateDay(D, day) {
  const agg = { day, visits: 0, uniques: 0, trains: {}, searches: {}, devices: {}, countries: {}, hours: Array(24).fill(0), refs: {}, events: 0 };
  const seen = new Set();
  const { results } = await D.prepare("SELECT t, h, v, d, c, s, q, r FROM ev WHERE day = ?").bind(day).all();
  for (const r of results) {
    agg.events++;
    if (r.v) seen.add(r.v);
    if (r.t === "visit") { agg.visits++; inc(agg.devices, r.d); inc(agg.countries, r.c); inc(agg.refs, r.r); if (r.h >= 0 && r.h < 24) agg.hours[r.h]++; }
    else if (r.t === "train") inc(agg.trains, r.s);
    else if (r.t === "search") inc(agg.searches, r.q);
  }
  agg.uniques = seen.size;
  return agg;
}

export async function onRequestGet({ request, env }) {
  const pass = env.ADMIN_PASSWORD;
  if (!pass) return new Response("ADMIN_PASSWORD tanımlı değil", { status: 503 });
  let given = request.headers.get("x-admin-key") || "";
  try { given = decodeURIComponent(given); } catch {}
  if (!same(given.trim(), pass.trim())) return new Response("Yetkisiz", { status: 401 });
  const days = Math.max(1, Math.min(90, parseInt(new URL(request.url).searchParams.get("days") || "7", 10) || 7));
  const D = await db(env), today = trDay();
  const list = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - i); list.push(d.toISOString().slice(0, 10)); }
  const out = [];
  for (const day of list) {
    if (day === today) { out.push(await aggregateDay(D, day)); continue; }
    const row = await D.prepare("SELECT v FROM rollup WHERE day = ?").bind(day).first();
    let r = row ? JSON.parse(row.v) : null;
    if (!r) {
      r = await aggregateDay(D, day);
      await D.batch([
        D.prepare("INSERT OR REPLACE INTO rollup (day, v) VALUES (?, ?)").bind(day, JSON.stringify(r)),
        D.prepare("DELETE FROM ev WHERE day = ?").bind(day),
      ]);
    }
    out.push(r);
  }
  return Response.json({ today, days: out }, { headers: { "cache-control": "no-store" } });
}
