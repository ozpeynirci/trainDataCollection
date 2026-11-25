// Son canlı durumlar: { trains: { "trenNo|seferGünü": {...} } }
import { db } from "../../lib/db.js";

export async function onRequestGet({ env }) {
  const D = await db(env);
  const { results } = await D.prepare("SELECT key, v, updated FROM trains WHERE updated > ?").bind(Date.now() - 3 * 86400000).all();
  const trains = {}; let receivedAt = 0;
  for (const r of results) { try { trains[r.key] = JSON.parse(r.v); } catch {} receivedAt = Math.max(receivedAt, r.updated); }
  return Response.json({ trains, receivedAt: receivedAt ? new Date(receivedAt).toISOString() : null },
    { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
}
