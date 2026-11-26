// Takip edilen trenler. GET herkese açık (site ve veri toplayıcı okur), POST yalnızca yönetici.
// Kayıt yoksa: tüm katalog açık sayılır (enabled: null).
import { db } from "../../lib/db.js";
import { requireAdmin } from "../../lib/auth.js";

export async function onRequestGet({ env }) {
  const D = await db(env);
  const row = await D.prepare("SELECT v FROM config WHERE k = 'trains'").first();
  let enabled = null; try { enabled = row ? JSON.parse(row.v).enabled : null; } catch {}
  return Response.json({ enabled }, { headers: { "cache-control": "public, max-age=30", "access-control-allow-origin": "*" } });
}

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env); if (deny) return deny;
  let b; try { b = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (!Array.isArray(b?.enabled) || b.enabled.length > 200 || !b.enabled.every(s => typeof s === "string" && /^[a-z0-9-]{2,60}$/.test(s)))
    return new Response("Geçersiz liste", { status: 400 });
  const D = await db(env);
  const v = JSON.stringify({ enabled: [...new Set(b.enabled)], updatedAt: new Date().toISOString() });
  await D.prepare("INSERT INTO config (k, v) VALUES ('trains', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(v).run();
  return Response.json({ ok: true });
}
