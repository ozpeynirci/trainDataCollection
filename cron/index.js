// Rayda zamanlayıcısı: GitHub'ın planlı işleri güvenilmez olduğu için veri toplayıcıyı saatte bir buradan başlatır.
// GH_TOKEN: yalnızca trainDataCollection reposunda "Actions: Read and write" izni olan GitHub anahtarı (gizli).
const URL_ = "https://api.github.com/repos/ozpeynirci/trainDataCollection/actions/workflows/collect.yml/dispatches";

async function dispatch(env) {
  if (!env.GH_TOKEN) { console.log("GH_TOKEN tanımlı değil"); return 503; }
  const r = await fetch(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28", "user-agent": "rayda-cron", "content-type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
  });
  console.log("dispatch", r.status, r.status === 204 ? "" : await r.text());
  return r.status;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(dispatch(env)); },
  async fetch() { return new Response("Rayda zamanlayıcısı çalışıyor.", { headers: { "content-type": "text/plain; charset=utf-8" } }); },
};
