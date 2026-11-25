// Veri çekicinin gönderdiği canlı durumları kaydeder (yalnızca doğru gizli anahtarla).
import { db, same } from "../../lib/db.js";
import { merge } from "../../lib/merge.js";

export async function onRequestPost({ request, env }) {
  const secret = env.PUSH_SECRET;
  if (!secret) return new Response("PUSH_SECRET tanımlı değil", { status: 503 });
  if (!same(request.headers.get("x-push-secret") || "", secret)) return new Response("Forbidden", { status: 403 });
  let body; try { body = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const list = Array.isArray(body?.statuses) ? body.statuses : [];
  const D = await db(env), now = Date.now(); let saved = 0;
  for (const s of list) {
    if (!s || !/^\d+$/.test(String(s.trainNo)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.service)) || !s.updatedAt) continue;
    const key = `${s.trainNo}|${s.service}`;
    const row = await D.prepare("SELECT v FROM trains WHERE key = ?").bind(key).first();
    let prev = null; try { prev = row ? JSON.parse(row.v) : null; } catch {}
    const v = JSON.stringify(merge(prev, s));
    await D.prepare("INSERT INTO trains (key, v, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET v = excluded.v, updated = excluded.updated").bind(key, v, now).run();
    saved++;
  }
  await D.prepare("DELETE FROM trains WHERE updated < ?").bind(now - 3 * 86400000).run();
  return Response.json({ saved });
}
