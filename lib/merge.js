// Sefer durumunu öncekiyle birleştirir: istasyon geçmişi (planlanan / son beklenen / gerçekleşen) ve gecikme.
const KEEP = ["trainNo", "slug", "service", "updatedAt", "lastPassedIdx", "nextIdx", "lastPassed", "next",
  "nextExpected", "arrived", "queries"];
const toMin = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const fmt = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const diff = (a, b) => { let d = toMin(a) - toMin(b); if (d < -720) d += 1440; if (d > 720) d -= 1440; return d; };   // a - b (dk)
const okTime = t => typeof t === "string" && /^\d{2}:\d{2}$/.test(t);

export function merge(prev, s) {
  const out = Object.fromEntries(KEEP.filter(k => k in s).map(k => [k, s[k]]));
  const hist = { ...(prev && prev.hist || {}) };
  const nowTr = fmt(new Date(Date.parse(s.updatedAt) + 180 * 60000).getUTCHours() * 60 + new Date(Date.parse(s.updatedAt) + 180 * 60000).getUTCMinutes());
  const prevDelay = prev && Number.isFinite(prev.delayMin) ? prev.delayMin : 0;
  const approxDelay = Math.max(0, Number.isFinite(s.delayMin) ? s.delayMin : prevDelay);
  for (const o of Array.isArray(s.obs) ? s.obs : []) {
    if (!Number.isInteger(o.idx) || !okTime(o.sched)) continue;
    const h = { ...(hist[o.idx] || {}), s: o.sched };
    if (o.kind === "expected" && okTime(o.time)) h.e = o.time;
    if (o.kind === "passed" && !h.a) {
      if (h.e) h.a = h.e;                                    // geçmeden önce TCDD'nin verdiği son beklenen saat
      else { h.a = fmt(toMin(o.sched) + approxDelay); h.x = 1; } // daha önce görülmedi: tarifeye bilinen gecikme eklenir (yaklaşık)
      if (diff(h.a, nowTr) > 0) h.a = nowTr;                   // gelecekte olamaz
    }
    hist[o.idx] = h;
  }
  out.hist = hist;
  // son geçilen istasyondaki gecikme (gerçekleşen - planlanan)
  // (yaklaşık değerler, yani TCDD'den gerçek saat görülmeyenler, gecikmeyi belirlemez)
  const passed = Object.keys(hist).map(Number).filter(i => hist[i].a).sort((a, b) => b - a);
  const real = passed.filter(i => !hist[i].x);
  out.lastStationIdx = real.length ? real[0] : null;
  out.lastStationDelay = real.length ? diff(hist[real[0]].a, hist[real[0]].s) : null;
  out.nextDelay = Number.isFinite(s.delayMin) ? s.delayMin : null;
  // tahmin için kullanılan gecikme: son gerçek istasyon; o daha eskiyse ya da yoksa sıradaki istasyonun beklenen saati
  const latestIsApprox = passed.length && hist[passed[0]].x;
  out.delayMin = (!latestIsApprox && out.lastStationDelay != null) ? out.lastStationDelay
    : (out.nextDelay ?? out.lastStationDelay ?? (prev && Number.isFinite(prev.delayMin) ? prev.delayMin : null));
  return out;
}
