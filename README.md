# trainDataCollection

TCDD anahat trenleri için canlı konum sitesi ve gecikme verisi toplayıcı.

Takip edilen seferler (her gün):

| Tren | Yön | No |
|---|---|---|
| Konya Mavi Treni | İzmir (Basmane) → Konya | 32007 |
| Konya Mavi Treni | Konya → İzmir (Basmane) | 72008 |
| İzmir Mavi Treni | İzmir (Basmane) → Ankara | 32005 |
| İzmir Mavi Treni | Ankara → İzmir (Basmane) | 22006 |
| Doğu Ekspresi | Ankara → Kars | 22010 |
| Doğu Ekspresi | Kars → Ankara | 92009 |

## Nasıl çalışır

- **Canlı durum** (`.github/workflows/collect.yml`, 30 dakikada bir): `scraper/scrape.mjs` o an yolda olan seferleri bulur,
  TCDD "Trenim Nerede" sayfasında birkaç istasyonu sorgular ("GİTTİ" / beklenen saat), konum ve rötarı hesaplar,
  sonucu Netlify'a (`/api/push`) gönderir. Kalıcı kayıt tutulmaz; repoya hiçbir şey yazılmaz.
- **Site** (`site/index.html`): arama + sefer listesi, sefer sayfasında harita; dakikada bir `/api/status` okur.
  Canlı veri yoksa tarifeye göre gösterir.
- **Ziyaret istatistiği:** site anonim olay gönderir (`/api/track`: ziyaret, sefer görüntüleme, arama).
  IP veya kişisel veri saklanmaz; tekil ziyaretçi günlük tuzlanmış özetle sayılır.
- **Yönetim sayfası:** `https://mavitrentakip.netlify.app/admin` — şifreyle girilir (`ADMIN_PASSWORD`).
  Ziyaret, tekil ziyaretçi, sefer görüntülemeleri, aramalar, saat/cihaz/ülke/kaynak dağılımı; bugün / 7 / 30 / 90 gün.

## Kurulum (bir kez)

1. Bu klasörün içeriğini repoya yükleyin (`.github` klasörü dahil).
2. **Netlify:** mavitrentakip sitesini bu repoya bağlayın (ayarlar `netlify.toml`'dan okunur).
3. **Netlify ortam değişkenleri:**
   - `PUSH_SECRET`: uzun rastgele metin (veri toplayıcının yazma anahtarı)
   - `ADMIN_PASSWORD`: yönetim sayfası şifresi
   - `STATS_SALT`: uzun rastgele metin (tekil ziyaretçi özeti için; isteğe bağlı ama önerilir)
4. **GitHub** → *Settings → Secrets and variables → Actions*: Secrets'a `PUSH_SECRET` (Netlify'dakiyle aynı),
   Variables'a `SITE_URL` = `https://mavitrentakip.netlify.app`.
5. Netlify'da yeniden deploy; GitHub → *Actions → TCDD canli durum → Run workflow* ile ilk çalıştırma.

## Kota notu

Repo **public** olmalı: public repolarda GitHub Actions dakikaları ücretsiz ve sınırsız. Repoda şifre ya da kişisel veri yoktur;
gizli anahtarlar GitHub Secrets ve Netlify ortam değişkenlerinde durur.

## Yeni tren eklemek

1. `data_src/tcdd_raw.json`'a TCDD sefer detayını ekleyin (istasyon, varış, kalkış).
2. Yeni hat ise `build/build_lines.py` içindeki `ANCHORS` ve `LINES`'a ekleyin; `build/build_trains.py` içindeki `META`'ya treni ekleyin.
3. `python3 build/build_lines.py && python3 build/build_trains.py && python3 build/build_site.py`
   (harita verisi: Natural Earth `ne_10m_railroads.geojson`, `build_lines.py`'ye klasör yolu verilir).
