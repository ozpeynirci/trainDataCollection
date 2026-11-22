// Saf mantık: tarifeler, sefer günleri, sorgulanabilir istasyonlar ve GİTTİ / beklenen saat sınırı.
import { readFileSync } from "node:fs";

export const TRAINS = JSON.parse(readFileSync(new URL("../trains.json", import.meta.url), "utf8"));

export const toMin = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

// Her tren için kalkıştan itibaren dakika (gece yarısı aşılarak) ve gün kayması
for (const T of TRAINS) {
  T.DEP = toMin(T.stops[0].d);
  let prev = T.DEP;
  T.st = T.stops.map(s => {
    const conv = x => { if (!x) return null; let v = toMin(x); while (v < prev) v += 1440; prev = v; return v - T.DEP; };
    const arr = conv(s.a), dep = conv(s.d);
    return { ...s, arr: arr ?? dep, dep: dep ?? arr };
  });
  T.TOTAL = T.st[T.st.length - 1].arr;
  T.LAST = T.st.length - 1;
}

export function istanbulNow(date = new Date()) {
  const loc = new Date(date.getTime() + 180 * 60000);
  return { ymd: loc.toISOString().slice(0, 10), min: loc.getUTCHours() * 60 + loc.getUTCMinutes() };
}
export const addDays = (ymd, k) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

// Şu an yolda (ya da 10 dk içinde kalkacak / 60 dk önce varmış) seferler
export function activeServices(now = new Date(), prevStatus = {}) {
  const { ymd, min } = istanbulNow(now), out = [];
  for (const T of TRAINS) {
    const maxK = Math.ceil((T.DEP + T.TOTAL) / 1440) + 1;
    for (let k = maxK; k >= 0; k--) {
      const service = addDays(ymd, -k);
      const prev = prevStatus[`${T.no}|${service}`];
      if (prev && prev.arrived) continue;
      const delay = prev && Number.isFinite(prev.delayMin) ? prev.delayMin : 0;
      const elapsed = min + k * 1440 - T.DEP;           // kalkıştan beri (dk)
      if (elapsed >= -10 && elapsed - delay <= T.TOTAL + 60) out.push({ T, service, elapsed, delay });
    }
  }
  return out;
}

// İstasyon i'nin tarifedeki geçiş günü (sefer günü + kayma)
export function passDate(T, service, i) {
  const s = T.st[i];
  const t = (i === T.LAST ? s.arr : s.dep);
  return addDays(service, Math.floor((T.DEP + t) / 1440));
}
// Yalnızca bugün listelenen istasyonlar sorgulanabilir (TCDD istasyon listesi günlük)
export function queryableRange(T, service, now = new Date()) {
  const { ymd } = istanbulNow(now);
  let lo = null, hi = null;
  for (let i = 0; i <= T.LAST; i++) {
    const d = dayDiff(passDate(T, service, i), ymd);
    if (d === 0) { if (lo === null) lo = i; hi = i; }
  }
  // dünün istasyonları: geçildi say; yarının istasyonları: henüz değil
  return { lo, hi };
}

export function estimateIndex(T, elapsed, delay = 0) {
  const t = elapsed - delay;
  for (let i = 0; i <= T.LAST; i++) if (T.st[i].arr >= t) return i;
  return T.LAST;
}

export function classify(cell) {
  if (cell == null) return { kind: "absent" };
  const s = cell.toLocaleUpperCase("tr-TR").replace(/\s+/g, " ").trim();
  if (/G[İI]TT[İI]|GELD[İI]|VARDI/.test(s)) return { kind: "passed" };
  const m = s.match(/(\d{1,2}):(\d{2})(?!.*\d{1,2}:\d{2})/);
  if (m) return { kind: "expected", time: `${m[1].padStart(2, "0")}:${m[2]}` };
  return { kind: "unknown" };
}
export function delayFrom(expected, scheduled) {
  let d = toMin(expected) - toMin(scheduled);
  if (d < -720) d += 1440; if (d > 720) d -= 1440;
  return d;
}
// istasyonda tablodaki "Kalkış/Varış Saati" (son durakta varış, diğerlerinde kalkış)
export const schedAt = (T, i) => (i === T.LAST ? T.stops[i].a : (T.stops[i].d || T.stops[i].a));

/**
 * Sınır: GİTTİ yazan son istasyon (L) ile beklenen saat gösteren ilk istasyon (R).
 * query(i) -> Promise<{kind,time?}> ; [lo,hi] dışı sorgulanmaz (öncesi geçildi, sonrası gelecek).
 */
export async function findBoundary(T, query, startIdx, lo, hi, maxQueries = 8) {
  const obs = new Map(); let n = 0;
  const q = async i => {
    if (lo === null || i < lo) return { kind: "passed", inferred: true };
    if (i > hi) return { kind: "future" };
    if (obs.has(i)) return obs.get(i);
    if (n >= maxQueries) return { kind: "skipped" };
    n++; const r = await query(i); obs.set(i, r); return r;
  };
  const good = r => r.kind === "passed" || r.kind === "expected" || r.kind === "future";
  const LAST = T.LAST;
  const probe = async (i, a, b) => {
    for (const j of [i, i + 1, i - 1, i + 2, i - 2]) {
      if (j < a || j > b) continue;
      const r = await q(j);
      if (good(r)) return [j, r];
      if (r.kind === "skipped") return null;
    }
    return null;
  };
  let L = null, R = null;
  const first = await probe(Math.max(0, Math.min(LAST, startIdx)), 0, LAST);
  if (first) {
    const [i, r] = first;
    if (r.kind === "passed") {
      L = i;
      for (let step = 1; L < LAST; step *= 2) {
        const p = await probe(Math.min(LAST, L + step), L + 1, LAST); if (!p) break;
        if (p[1].kind === "passed") L = p[0]; else { R = p[0]; break; }
      }
    } else {
      R = i;
      for (let step = 1; R > 0; step *= 2) {
        const p = await probe(Math.max(0, R - step), 0, R - 1); if (!p) break;
        if (p[1].kind !== "passed") R = p[0]; else { L = p[0]; break; }
      }
    }
    while (L != null && R != null && R - L > 1) {
      const p = await probe(Math.floor((L + R) / 2), L + 1, R - 1); if (!p) break;
      if (p[1].kind === "passed") L = p[0]; else R = p[0];
    }
  }
  let delayMin = null, nextExpected = null;
  if (R != null) {
    const o = obs.get(R) || {};
    if (o.kind === "expected") { nextExpected = o.time; delayMin = delayFrom(o.time, schedAt(T, R)); }
  }
  return {
    ok: obs.size > 0 && (L != null || R != null),
    lastPassedIdx: L, nextIdx: R, nextExpected, delayMin, arrived: L === LAST,
    queries: n,
    observations: [...obs.entries()].sort((a, b) => a[0] - b[0])
      .map(([idx, o]) => ({ idx, station: T.stops[idx].tcdd, sched: schedAt(T, idx), kind: o.kind, time: o.time || null })),
  };
}
