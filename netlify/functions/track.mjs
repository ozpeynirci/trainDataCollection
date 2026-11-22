// Anonim ziyaret olayı kaydı. IP, tarayıcı izi ya da kişisel veri saklanmaz.
// Ziyaretçi kimliği tarayıcıda üretilen rastgele bir sayıdır; sunucuda günlük tuzla özetlenip saklanır
// (aynı kişi farklı günlerde eşleştirilemez).
import { getStore } from "@netlify/blobs";
import { createHash, randomUUID } from "node:crypto";

const TYPES = new Set(["visit", "train", "search"]);
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : null);

export default async (req, context) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  let e;
  try { const t = await req.text(); if (t.length > 2000) return new Response(null, { status: 413 }); e = JSON.parse(t); }
  catch { return new Response(null, { status: 400 }); }
  if (!e || !TYPES.has(e.t)) return new Response(null, { status: 400 });

  const now = new Date();
  const tr = new Date(now.getTime() + 180 * 60000);           // Türkiye saati
  const day = tr.toISOString().slice(0, 10);
  const salt = Netlify.env.get("STATS_SALT") || "trentakip";
  const vid = typeof e.v === "string" && /^[a-z0-9-]{8,40}$/i.test(e.v)
    ? createHash("sha256").update(`${salt}|${day}|${e.v}`).digest("hex").slice(0, 16) : null;
  const ua = req.headers.get("user-agent") || "";
  if (/bot|crawl|spider|slurp|headless|lighthouse|preview/i.test(ua)) return new Response(null, { status: 204 });

  let ref = null;
  try { if (e.r) { const h = new URL(e.r).hostname.replace(/^www\./, ""); if (h && !h.endsWith(new URL(req.url).hostname)) ref = h; } } catch {}

  const rec = {
    t: e.t, ts: now.toISOString(), h: tr.getUTCHours(), v: vid,
    d: /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobil" : "masaüstü",
    c: context?.geo?.country?.code || null,
    s: e.t === "train" ? clip(e.s, 60) : null,
    q: e.t === "search" ? clip(String(e.q || "").toLocaleLowerCase("tr-TR").trim(), 40) : null,
    r: e.t === "visit" ? ref : null,
  };
  await getStore("stats").setJSON(`ev/${day}/${now.getTime()}-${randomUUID().slice(0, 8)}`, rec);
  return new Response(null, { status: 204 });
};

export const config = { path: "/api/track" };
