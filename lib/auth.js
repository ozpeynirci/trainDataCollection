// Yönetim oturumu: kullanıcı adı + şifre ile giriş, 12 saat geçerli imzalı anahtar (HMAC-SHA256).
// ADMIN_USER tanımlı değilse kullanıcı adı "admin" kabul edilir.
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = s => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
export const adminUser = env => (env.ADMIN_USER || "admin").trim();
const keyOf = env => `rayda|${env.ADMIN_PASSWORD}|${env.STATS_SALT || ""}`;

export async function makeToken(env, hours = 12) {
  const body = b64u(enc.encode(JSON.stringify({ u: adminUser(env), exp: Date.now() + hours * 3600000 })));
  return { token: `${body}.${await hmac(keyOf(env), body)}`, exp: Date.now() + hours * 3600000 };
}
// İstek geçerli bir oturum taşıyor mu? Yanıt: null (geçerli) ya da hata Response'u
export async function requireAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return new Response("ADMIN_PASSWORD tanımlı değil", { status: 503 });
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)$/.exec(request.headers.get("authorization") || "");
  if (!m) return new Response("Yetkisiz", { status: 401 });
  if (await hmac(keyOf(env), m[1]) !== m[2]) return new Response("Yetkisiz", { status: 401 });
  try { const p = JSON.parse(fromB64u(m[1])); if (!(p.exp > Date.now()) || p.u !== adminUser(env)) return new Response("Oturum süresi doldu", { status: 401 }); }
  catch { return new Response("Yetkisiz", { status: 401 }); }
  return null;
}
