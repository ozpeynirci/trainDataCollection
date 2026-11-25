// D1 veritabanı: tablolar ilk istekte kendiliğinden oluşturulur.
let ready = null;
export function db(env) {
  if (!env.DB) throw new Error("DB bağlantısı tanımlı değil (Pages → Settings → Bindings → D1, adı DB)");
  if (!ready) ready = env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS trains (key TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ev (day TEXT NOT NULL, ts INTEGER NOT NULL, t TEXT, h INTEGER, v TEXT, d TEXT, c TEXT, s TEXT, q TEXT, r TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ev_day ON ev(day)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rollup (day TEXT PRIMARY KEY, v TEXT NOT NULL)"),
  ]).catch(e => { ready = null; throw e; });
  return ready.then(() => env.DB);
}
// sabit zamanlı karşılaştırma
export function same(a, b) {
  a = String(a); b = String(b); if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
export const trDay = (t = Date.now()) => new Date(t + 180 * 60000).toISOString().slice(0, 10);
