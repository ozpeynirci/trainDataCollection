// Son canlı durumlar: { trains: { "trenNo|seferGünü": {...} } }
import { getStore } from "@netlify/blobs";

export default async () => {
  const s = await getStore("trains").get("status", { type: "json" });
  return Response.json(s || { trains: {} }, { headers: { "cache-control": "public, max-age=30" } });
};

export const config = { path: "/api/status" };
