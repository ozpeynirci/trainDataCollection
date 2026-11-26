// Yönetim girişi. 15 dakikada aynı adresten 5 hatalı denemeden sonra geçici olarak kilitlenir.
import { db, same } from "../../lib/db.js";
import { adminUser, makeToken } from "../../lib/auth.js";

async function who(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "?";
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.STATS_SALT || ""}|${ip}`));
  return [...new Uint8Array(b)].slice(0, 8).map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) return new Response("ADMIN_PASSWORD tanımlı değil", { status: 503 });
  let b; try { b = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const D = await db(env), w = await who(request, env), since = Date.now() - 15 * 60000;
  const { n } = await D.prepare("SELECT COUNT(*) AS n FROM login_fail WHERE who = ? AND ts > ?").bind(w, since).first();
  if (n >= 5) return new Response("Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.", { status: 429 });
  const okUser = same(String(b?.user || "").trim().toLocaleLowerCase("tr-TR"), adminUser(env).toLocaleLowerCase("tr-TR"));
  const okPass = same(String(b?.pass || ""), env.ADMIN_PASSWORD.trim()) || same(String(b?.pass || "").trim(), env.ADMIN_PASSWORD.trim());
  if (!(okUser && okPass)) {
    await D.batch([
      D.prepare("INSERT INTO login_fail (who, ts) VALUES (?, ?)").bind(w, Date.now()),
      D.prepare("DELETE FROM login_fail WHERE ts < ?").bind(Date.now() - 86400000),
    ]);
    return new Response("Kullanıcı adı ya da şifre hatalı", { status: 401 });
  }
  await D.prepare("DELETE FROM login_fail WHERE who = ?").bind(w).run();
  return Response.json(await makeToken(env), { headers: { "cache-control": "no-store" } });
}
