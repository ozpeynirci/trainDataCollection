// Son canlı durumlar: { trains: { "trenNo|seferGünü": {...} } }
// Yanıt Netlify CDN'inde 2 dk önbelleklenir: ziyaretçi sayısı ne olursa olsun fonksiyon en fazla 2 dk'da bir çalışır.
import { getStore } from "@netlify/blobs";

export default async () => {
  const s = await getStore("trains").get("status", { type: "json" });
  return Response.json(s || { trains: {} }, {
    headers: {
      "cache-control": "public, max-age=60",
      "netlify-cdn-cache-control": "public, durable, s-maxage=120, stale-while-revalidate=300",
    },
  });
};

export const config = { path: "/api/status" };
