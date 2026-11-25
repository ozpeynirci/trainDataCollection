// Anonim ziyaret olayı kaydı. IP, tarayıcı izi ya da kişisel veri saklanmaz.
// Ziyaretçi kimliği tarayıcıda üretilen rastgele bir sayıdır; sunucuda günlük tuzla özetlenir
// (aynı kişi farklı günlerde eşleştirilemez).
import { db, trDay } from "../../lib/db.js";

const TYPES = new Set(["visit", "train", "search"]);
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : null);
async function sha(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 16); }

export async function onRequestPost({ request, env }) {
  let e;
  try { const t = await request.text(); if (t.length > 2000) return new Response(null, { status: 413 }); e = JSON.parse(t); }
  catch { return new Response(null, { status: 400 }); }
  if (!e || !TYPES.has(e.t)) return new Response(null, { status: 400 });
  const ua = request.headers.get("user-agent") || "";
  if (/bot|crawl|spider|slurp|headless|lighthouse|preview/i.test(ua)) return new Response(null, { status: 204 });

  const now = Date.now(), day = trDay(now), hour = new Date(now + 180 * 60000).getUTCHours();
  const salt = env.STATS_SALT || "rayda";
  const vid = typeof e.v === "string" && /^[a-z0-9-]{8,40}$/i.test(e.v) ? await sha(`${salt}|${day}|${e.v}`) : null;
  let ref = null;
  try { if (e.r) { const h = new URL(e.r).hostname.replace(/^www\./, ""); if (h && !h.endsWith(new URL(request.url).hostname)) ref = h; } } catch {}

  const D = await db(env);
  await D.prepare("INSERT INTO ev (day, ts, t, h, v, d, c, s, q, r) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
    day, now, e.t, hour, vid,
    /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobil" : "masaüstü",
    request.cf?.country || null,
    e.t === "train" ? clip(e.s, 60) : null,
    e.t === "search" ? clip(String(e.q || "").toLocaleLowerCase("tr-TR").trim(), 40) : null,
    e.t === "visit" ? ref : null,
  ).run();
  return new Response(null, { status: 204 });
}
