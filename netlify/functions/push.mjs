// Veri çekicinin gönderdiği canlı durumları kaydeder (yalnızca doğru gizli anahtarla).
import { getStore } from "@netlify/blobs";

const KEEP = ["trainNo", "slug", "service", "updatedAt", "lastPassedIdx", "nextIdx", "lastPassed", "next",
  "nextExpected", "delayMin", "lastDelay", "arrived", "queries"];

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Netlify.env.get("PUSH_SECRET");
  if (!secret || req.headers.get("x-push-secret") !== secret) return new Response("Forbidden", { status: 403 });
  let body; try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const list = Array.isArray(body?.statuses) ? body.statuses : [];
  const store = getStore("trains");
  const cur = (await store.get("status", { type: "json" })) || { trains: {} };
  for (const s of list) {
    if (!s || !/^\d+$/.test(String(s.trainNo)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.service))) continue;
    cur.trains[`${s.trainNo}|${s.service}`] = Object.fromEntries(KEEP.filter(k => k in s).map(k => [k, s[k]]));
  }
  const now = Date.now();
  for (const k of Object.keys(cur.trains)) if (now - Date.parse(cur.trains[k].updatedAt || 0) > 3 * 86400000) delete cur.trains[k];
  cur.receivedAt = new Date().toISOString();
  await store.setJSON("status", cur);
  return Response.json({ saved: list.length });
};

export const config = { path: "/api/push" };
