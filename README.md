# ⚔ Savaş Arenası

Lobili, **her lobide en fazla 20 kişilik** 2D tepeden bakış çok oyunculu savaş oyunu.
Tarayıcıda çalışır, telefona uygulama olarak kurulur, **internetsiz de oynanır**.

- 🎮 Üç mod: Herkes Herkese, Takım Savaşı, Son Hayatta Kalan — her maç **5 dakika**
- 🌿 Saklanılabilen çalılar: içinden geçilir, içindeki oyuncu uzaktan görünmez
- 🗺 Her maçta farklı harita — aynı tarz, yeni yerleşim
- 🧍 8 pixel-art karakter, lobiden seçilir; hepsi silahını elinde taşır
- 🔫 Sınırlı cephane + kendiliğinden yenilenen can
- 👥 Lobi sistemi: açık liste, gizli lobi + 5 harflik kod, sohbet, hazır durumu
- 🤖 Botlar: tek başına da dolu bir arena
- 📴 **Çevrimdışı mod:** oyun sunucusu cihazın içinde çalışır — internet, PC, kurulum gerekmez
- 📱 **PWA:** "Ana ekrana ekle" ile gerçek uygulama gibi durur
- 🤖 **Android APK:** hazır Capacitor projesi + GitHub'da ücretsiz derleme
- ☁️ **Bulut sunucu:** senin bilgisayarın kapalıyken de arkadaşlarınla online

---

## 0. Telefonda internetsiz oynamak: **tek dosya** (en kolay yol)

`dist/savas-arenasi.html` — oyunun tamamı tek bir HTML dosyasında. Sunucu yok,
kurulum yok, internet yok, HTTPS yok.

### Telefona nasıl atılır? (en kolay: sunucudan indir)

Bilgisayar açıkken bir kez şunu yap, bir daha uğraşmazsın:

1. Bilgisayarda `npm start`.
2. Telefonda (aynı wifi) `http://192.168.x.x:3000` adresini aç.
3. Menünün altındaki **⬇ İnternetsiz sürümü indir** düğmesine bas.
4. Dosya telefonun **İndirilenler** klasörüne iner.
5. **Dosyalar** uygulamasından `savas-arenasi.html` üzerine dokun → *Chrome ile aç*.

Artık bilgisayar kapalı, wifi yok, internet yok — hiç fark etmez. Dosya
telefonun içinde ve kendi kendine yetiyor. Ana ekrana kısayol da koyabilirsin
(Chrome ⋮ → *Ana ekrana ekle*).

Alternatif yollar (aynı sonuç): WhatsApp'ta kendine gönder, Google Drive'a
yükle, ya da USB kabloyla kopyala.

Yeniden üretmek için:

```bash
npm run build:single
```

### Neden bu dosya gerekti?

Telefonda `http://192.168.1.169:3000` yazarak açtığında oyunu **çevrimdışı
kaydedemezsin**. Sebebi oyun değil, tarayıcı kuralı:

> Tarayıcılar service worker'ı (çevrimdışı önbelleği) **yalnızca güvenli
> kaynaklarda** çalıştırır: `https://` ya da `localhost`. Ev ağındaki
> `http://192.168.x.x` güvensiz sayılır.

Yani o adreste önbellek hiç kurulmaz. Bilgisayarı kapatınca Chrome kendi eski
anlık görüntüsünü gösterir — üstte *"şu zamandan kalma veri"* yazar ve o sayfada
JavaScript çalışmadığı için hiçbir şeye basamazsın. Tam olarak yaşadığın şey bu.

Oyun artık bu durumu sessizce geçmiyor: `http://` ile açıldığında ana menüde
turuncu bir uyarı çıkıp seni bu tek dosyaya yönlendiriyor.

Üç çözüm var, üçü de bu dosyada anlatılıyor:

| İstediğin | Çözüm |
|---|---|
| Telefonda tek başına, internetsiz | **Tek dosya** (bu bölüm) ya da APK (bölüm 3) |
| Aynı evdeki arkadaşlarla | `http://192.168.x.x:3000` (bölüm 1) |
| Başka şehirdeki / mobil verideki arkadaşlarla | Bulut sunucu (bölüm 4) |

---

## 1. En hızlı yol: sadece oyna

```bash
npm start
```

Tarayıcıda **http://localhost:3000**.

> `npm install` gerekmiyor. Sunucunun **hiçbir dış paketi yok** — WebSocket
> katmanı dahil her şey depoda (`server/ws.js`). Node kuruluysa çalışır.

Menüde **Çevrimdışı** seçiliyse hiçbir şey daha gerekmez — lobi kur, bot sayısını
ayarla, başlat. Aynı wifi'deki arkadaşların için sunucu açılırken yazan
`http://192.168.x.x:3000` adresini paylaş.

> Node.js kurulu değilse: [nodejs.org](https://nodejs.org) → yeşil **LTS** butonu.

---

## 2. Telefona kurmak (PWA — en pratik)

Oyunun açık olduğu adresi telefonun tarayıcısında aç, sonra:

- **Android / Chrome:** sağ üst ⋮ → **Uygulamayı yükle** (ya da menüdeki 📲 *Uygulama olarak kur* butonu)
- **iPhone / Safari:** paylaş simgesi → **Ana Ekrana Ekle**

Kurulduktan sonra kendi ikonuyla, tam ekran, yatay modda açılır. Adres çubuğu yoktur.

**İnternet gerekmez** — ama tek bir şartla: sayfayı **`https://` ile açmış
olman** gerekir (bölüm 4'teki bulut sunucu ya da tünel adresi). `http://192.168…`
adresinde tarayıcı önbelleği kurmaz; orada PWA kurulumu da çevrimdışı çalışmaz.
Sunucusuz ve HTTPS'siz çevrimdışı oyun için **bölüm 0'daki tek dosyayı** kullan.

### Gündüz ve gece

Her maç **günün rastgele bir saatinde** başlar ve 5 dakikalık maç boyunca oyun
saati 6 saat ilerler — öğlen başlayıp akşamüstü bitirebilirsin.

* Güneş doğuda doğar, tepeden geçer, batıda batar.
* **Gölgeler güneşin tam tersine düşer** ve güneş alçaldıkça uzar: şafakta ve
  gün batımında upuzun, öğlen neredeyse yok. Hem binalar hem karakterler için.
* Işık düz boya değil **çarpma (multiply)** ile uygulanır. Düz boya sürmek her
  şeyi soluklaştırıp çimeni griye çeviriyordu; çarpma gerçek ışık gibi davranıp
  renkleri korur.
* Gece oyunun oynanabilir kalması için karakterin çevresinde yumuşak bir
  aydınlık halka vardır.

Ayarlar `shared/constants.js` içinde: `DAY_HOURS_PER_MATCH`, `SUNRISE_HOUR`,
`SUNSET_HOUR`.

### Hız: sabit dünya katmanı

Zemin ve binalar maç boyunca değişmez, ama her karede yeniden çizmek kare
süresinin yarısından fazlasını yiyordu (desen doldurma + 34 radyal gradyan +
bina başına bulanık gölge). Ölçüm yapıp üç şeyi düzelttik:

1. **Desen önceden ölçekleniyor.** `pattern.setTransform` her pikselde ek
   dönüşüm demek; onun yerine doku bir kez hedef boyuta çizilip desen ondan
   üretiliyor.
2. **Harita ölçekli lekeler pişiriliyor.** 34 radyal gradyan yerine küçük bir
   tuvale bir kez basılıp tek `drawImage` ile geriliyor.
3. **Dünya parçalara bölünüp önbelleğe alınıyor.** 512 px'lik parçalar bir kez
   çizilip saklanıyor; her karede sadece görünenler kopyalanıyor. Parçalar
   komşularının gölgelerini de içerecek şekilde biraz taşırılarak çiziliyor,
   yoksa sınırlarda dikiş görünürdü. Güneş gözle görülür şekilde hareket
   ettiğinde önbellek tazeleniyor (maç boyunca birkaç kez).

Ölçülen kare süresi: **27,6 ms → ~11 ms**. Zemin+bina katmanı 16,1 ms'den
3,8 ms'ye indi.

### Görünüm

* **Zemin çimen.** Gerçek bir çim fotoğrafı döşeniyor (`public/textures/grass.jpg`).
  Fotoğrafı hazırlayan betik (`npm run texture -- <görsel...>`) önce dokunun
  zaten dikişsiz olup olmadığını **ölçüyor**; dikiş yoksa hiç harmanlamıyor —
  körlemesine harmanlamak sağlam bir dokuyu bulanık bir bantla bozar. Birden
  fazla görsel verip `--mix` denirse görseller 4×4 hücreye bölünüp rastgele
  çevrilerek karıştırılıyor (tekrar periyodu 4 kat uzar).
  Bir kiremit dünyada `GRASS_TILE_PX` kadar yer kaplar: bu ölçek, çim
  tellerinin karaktere göre doğru boyutta görünmesini sağlar (daha büyük görsel
  bunu çözmez — mesele çözünürlük değil ölçek). Görsel yüklenmezse kodla
  üretilen yedek çimen devreye girer.
* **Duvarlar bina.** Engeller tepeden görünen binalar olarak çiziliyor: çatı
  yüzeyi, parapet (üst-solu aydınlık, alt-sağı karanlık), çatı panelleri ve
  büyük binalarda çatı pencereleri / havalandırmalar. Detaylar binanın
  konumundan türetiliyor, yani her karede aynı.
* **Yürüyüş animasyonu.** Yön başına 8 kare. Kareler ayrık ama gövdenin inip
  kalkması ve hafif yana salınımı sürekli bir sinüs olarak çizim sırasında
  uygulanıyor; hareket başlayıp bitince de yumuşakça açılıp sönüyor. Bu yüzden
  kareden kareye atlama görünmüyor.
* **Adım izi.** Ayağın yere bastığı karelerde küçük bir toz bulutu çıkıyor.

## APK: bir kere kur, güncellemeyi uygulamanın içinden al

APK oyunun tamamını içinde taşır, yani **internetsiz çalışır**. Ama içindeki
kopya kendiliğinden yenilenmez — o yüzden şöyle kuruldu:

1. Açılışta internet varsa uygulama sunucudaki `/surum.json` adresine bakar.
2. Sunucudaki damga uygulamanınkinden farklıysa üstte yeşil bir çubuk çıkar:
   **"Yeni sürüm hazır — GÜNCELLE / Şimdi değil"**.
3. **GÜNCELLE** denince uygulama sunucudaki güncel sürüme geçer ve bu tercihi
   hatırlar; sonraki açılışlarda doğrudan oraya gider. **Yeniden APK kurmak
   gerekmez.**
4. **İnternet yoksa hiçbir şey olmaz** — uygulama içindeki kopyayla açılır.
5. "Şimdi değil" denen sürüm bir daha sorulmaz.

Sürüm damgası `public/` ve `shared/` altındaki dosyaların içeriğinden üretilir
(`server/stamp.js`). Sunucu, `www/` paketi ve tek dosyalık sürüm **aynı işlevi**
kullanır — farklı olsalardı uygulama sunucuda hep "yeni sürüm var" sanırdı.
Menünün altında uygulamanın kendi damgası yazar, hangi sürümde olduğunu
görebilirsin.

Kendi sunucun varsa `shared/constants.js` → `UPDATE_SERVER` adresini değiştir.

### APK nasıl derlenir

`android/` klasörünün depoda olmasına gerek yok (90 dosya, GitHub'ın 100 dosya
sınırını tek başına dolduruyordu). GitHub Actions iş akışı projeyi
`capacitor.config.json`'dan kendisi üretiyor:

1. Depoda **Actions** sekmesi → **Android APK derle** → **Run workflow**.
2. Birkaç dakika sonra sayfanın altındaki **Artifacts** bölümünden
   `savas-arenasi-apk` dosyasını indir.
3. İçinden çıkan `.apk`'yı telefona at ve kur.

### Güncelle düğmesi

Oyun `https://` üzerinden açıldığında kendini tarayıcıya kaydeder (service
worker) — internetsiz de açılabilsin diye. Bunun bedeli şu: sunucuya yeni sürüm
yüklenince tarayıcı bir süre **eski kopyayı** göstermeye devam edebilir.

Ana menüdeki **🔄 Güncelle** düğmesi bunu tek tıkla çözer: kayıtlı kopyayı
(service worker) ve tüm önbellekleri siler, adrese tek seferlik bir damga
ekleyip sayfayı sıfırdan yükler, sonra damgayı adres çubuğundan temizler.
`npm run test:browser` bu düğmenin gerçekten sildiğini doğruluyor.

İnternetsiz tek dosya hâlâ `https://<sunucun>/savas-arenasi.html` adresinden
indirilebilir.

### Oyun içi ayarlar

Maç sırasında sağ üstteki **⚙** düğmesi (klavyede **Esc**) ayarları açar:
ses aç/kapa, ses seviyesi, tam ekran ve **MAÇTAN ÇIK**. Panel açıkken tuşlar
oyuna gitmez — menüde gezerken karakterin yürümeye devam etmez. Ses ayarı
tarayıcıda saklanır, bir dahaki açılışta hatırlanır.

### Telefon kontrolleri

| | |
|---|---|
| Sol çubuk | Hareket |
| Sağ çubuk | Nişan alma |
| ⟳ | Şarjör değiştir |
| ☰ (basılı tut) | Skor tablosu |

**Otomatik silahlarda** (Tüfek, Makineli) sağ çubuğu ittikçe ateş edilir.
**Tek atışlılarda** (Keskin Tüfek, Pompalı) çubukla nişan alırsın, **parmağını
kaldırınca** ateşlenir — pompalıda saçılma konisi, keskin tüfekte uzun nişan
çizgisi nereye gideceğini gösterir.

### Bilgisayar kontrolleri

`WASD` hareket · Fare nişan · Sol tık ateş · `R` şarjör · `Tab` skor · `Enter` sohbet

---

## 3. Gerçek APK dosyası üretmek

APK derlemek için Android SDK gerekir. Bilgisayarına hiçbir şey kurmadan,
GitHub'ın sunucularında ücretsiz derletebilirsin.

### GitHub üzerinden (kurulum yok)

1. [github.com](https://github.com) hesabı aç, **New repository** ile boş bir depo oluştur.
2. Bu klasörü depoya yükle (sürükle-bırak da olur; `node_modules` ve `www` klasörlerini atma).
3. Depoda **Actions** sekmesi → soldan **Android APK derle** → sağdan **Run workflow**.
4. 3–5 dakika sonra iş yeşile döner. Sayfanın altındaki **Artifacts** bölümünden
   `savas-arenasi-apk` dosyasını indir, içinden `savas-arenasi.apk` çıkar.
5. APK'yı telefona at, dokun, "bilinmeyen kaynak" uyarısına izin ver, kur.

Üretilen APK *debug* imzalıdır: telefona kurulur ve tam çalışır, sadece Play
Store'a yüklenemez. Store'a yükleyeceksen `.github/workflows/android.yml`
içindeki **release** işi hazır — depo ayarlarından şu Secrets'ları eklemen yeter:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

### Kendi bilgisayarında (Android Studio kuruluysa)

```bash
npm run android:apk
# Çıktı: android/app/build/outputs/apk/debug/app-debug.apk
```

Android Studio'da açmak için: `npm run android:open`

APK'nın içinde sunucu yoktur; **çevrimdışı modda açılır**. İstersen uygulama
içinden bir sunucu adresi girip online da oynayabilirsin.

---

## 4. Bilgisayarın kapalıyken online oynamak

Senin PC'n sunucu olduğunda, PC kapanınca oyun da kapanır. Kalıcı çözüm:
sunucuyu ücretsiz bir buluta koymak. Depo zaten hazır (`render.yaml`).

> **Not — GitHub tek seferde en fazla 100 dosya alıyor.** Bu projede 170 dosya
> var; tek başına `android/` klasörü 90 dosya. Render'ın bunlara ihtiyacı yok.
> Bu yüzden depoya sadece sunucu için gerekenleri yükle:
> `package.json`, `package-lock.json`, `render.yaml`, `README.md`, `.gitignore`
> ve `public`, `shared`, `server`, `scripts`, `test` klasörleri (toplam 51 dosya).
> Bunun hazır hâli **`savas-arenasi-SUNUCU.zip`** olarak veriliyor — onu açıp
> içindekileri yüklemen yeterli. `android/`, `www/` ve `dist/` klasörleri APK
> ve tek dosya üretimi için, onlar bilgisayarında kalsın.

1. **GitHub'a yükle.** Hesabın yoksa [github.com](https://github.com) → *Sign up*.
   Sonra sağ üstteki **+** → **New repository** → ad ver (`savas-arenasi`),
   **Public** seç → **Create repository**. Açılan sayfada
   *uploading an existing file* bağlantısına tıkla ve bilgisayarındaki proje
   klasörünün **içindeki her şeyi** (README.md, package.json, render.yaml,
   public, server, shared, scripts, test klasörleri) sürükleyip bırak →
   **Commit changes**.
   *(`node_modules` klasörünü yükleme — zaten gerekmiyor.)*
2. [render.com](https://render.com) → GitHub ile giriş yap (kredi kartı istemez).
3. **New → Blueprint** → depoyu seç. `render.yaml`'ı görüp ayarları kendi doldurur.
4. **Apply** de, 1–2 dakika bekle (kurulacak paket olmadığı için hızlıdır).
   Sana şuna benzer bir adres verir:
   `https://savas-arenasi.onrender.com`
5. Bu adresi herkes tarayıcısına yazar; ya da oyun menüsünde **Online** sekmesine
   yapıştırıp **Bağlan** der. Adres kaydedilir, bir daha girmen gerekmez.

**Ücretsiz planın tek kusuru:** servis 15 dakika boş kalınca uykuya geçer. İlk
giren oyuncu ~1 dakika bekler, sonra herkese açık ve hızlıdır. Bölge Frankfurt
seçili — Türkiye'ye en yakın olanı.

Uyanma anına denk gelen ilk istek yarım dönebilir: HTML gelir ama `style.css`
yerine sunucunun hata sayfası gelir ve oyun biçimsiz bir metin yığını gibi
görünür. Oyun bunu kendi kendine yakalıyor: `index.html` içindeki küçük açılış
bekçisi sayfanın gerçekten ayağa kalkıp kalkmadığını denetler, kalkmadıysa
"Sunucu uyanıyor…" perdesini gösterip sayfayı en fazla 3 kez tazeler, olmazsa
"Yeniden dene" düğmesi sunar. `npm run test:browser` bu senaryoyu 503 döndüren
sahte bir sunucuyla sınıyor.

### Geçici alternatif: tünel

PC'n açıkken hızlıca dışarı açmak istersen:

```bash
cloudflared tunnel --url http://localhost:3000
```

Verdiği `https://...trycloudflare.com` adresini paylaş. Kapatınca adres ölür.

---

## Oyun içeriği

### Modlar

Her maç **5 dakika** sürer; süre dolunca önde olan kazanır.

| Mod | Anlatım |
|---|---|
| **Herkes Herkese (FFA)** | Herkes tek başına. 20 öldürmeye ilk ulaşan ya da süre sonunda önde olan kazanır. |
| **Takım Savaşı (TDM)** | Kızıl Tugay ve Mavi Filo. 50 takım öldürmesi. Dost ateşi kapalı. |
| **Son Hayatta Kalan (BR)** | Tek can. Güvenli alan ~3,5 dakikada merkeze iner, dışarısı can yakar. Elenince başkalarını izlersin (tıkla/dokun, izlediğin değişir). |

### Çalılar

Haritadaki yeşil çalılar **engel değildir** — içinden yürünür, mermi geçer. Ama
içinde duran oyuncu **190 px'den uzaktan görünmez**. İçine girdiğin çalı sana
**saydamlaşır** (kesikli yeşil çemberle sınırı belli olur), böylece dışarıyı
görürsün; ekranda 🌿 GİZLİSİN yazar.

Çalı kalkan değil: **ateş ettiğin anda ~1 saniye açığa çıkarsın.** Pusu kurmak
için iyi, sürekli saklanmak için değil. Botlar da bu kuralın altındadır —
çalıdaki oyuncuyu onlar da uzaktan göremez.

### Karakterler

Lobide 8 karakterden birini seçersin: Kıvırcık, Diken, Yele, Kasketli, Karasaç,
Gümüş, Mavi Perçem, Esmer. Sadece görünüş; oynanışı etkilemez. Lobiye giren
herkese otomatik olarak farklı bir karakter atanır.

Karakterler hazır görsel dosyası değil — `public/js/sprites.js` içinde piksel
piksel **kodla çizilir**. Her karakter için 4 yön × 3 yürüyüş karesi üretilir;
nişan aldığın yöne göre karakter döner ve yürürken adım animasyonu oynar.
Takım Savaşı'nda üniforma takım rengini alır.

### Maç nasıl başlar?

Lobideki **herkes** (lobi sahibi dahil) HAZIRIM demeden maç başlamaz — zorla
başlatma yok. Altta kaç kişinin hazır olduğu yazar (`2 / 4 kişi hazır`). Herkes
hazır olunca ekranı kaplayan **5 · 4 · 3 · 2 · 1** geri sayımı başlar.

Tek başınaysan HAZIRIM demen yeterli; botlarla hemen başlar.

### Sınıflar

| Sınıf | Can | Hız | Silah | Cephane | Özet |
|---|---|---|---|---|---|
| Komando | 100 | 218 | Tüfek | 30 / 60 | Dengeli, her duruma uyar |
| Akıncı | 78 | 282 | Pompalı | 5 / 15 | Çok hızlı, yakın dövüş |
| Keskin Nişancı | 88 | 176 | Keskin tüfek | 5 / 15 | Tek atışta 82 hasar, uzun menzil |

Cephane ekranda **şarjördeki / yedek** biçiminde yazar (`30 / 60`). Yedek bitince
sayı kırmızıya döner. Haritadaki kutular yedeğin yarısını doldurur.

Sınıfı maç sırasında da değiştirebilirsin; bir sonraki doğuşta geçerli olur.

### Can ve cephane

**Can kutusu yok.** Canın kendiliğinden dolar: **2 saniyede 1 can**. Yani
çatışmadan çekilip beklemek işe yarar, ama çatışmanın ortasında seni kurtarmaz.

**Cephane sınırlıdır.** Her silahın bir şarjörü ve bir yedek havuzu var:

| Silah | Şarjör | Yedek | Toplam |
|---|---|---|---|
| Tüfek | 30 | 90 | 120 |
| Pompalı | 6 | 30 | 36 |
| Keskin tüfek | 5 | 25 | 30 |
| Makineli | 60 | 180 | 240 |

Şarjör doldurunca yedekten düşer. Yedek bitince ateş edemezsin — ekranda
**CEPHANE BİTTİ** yazar. Haritadaki sarı **cephane kutuları** yedeğinin yarısını
doldurur ve bir süre sonra yeniden doğar. Ölüp yeniden doğunca cephanen tazelenir.

Keskin nişancıda **nişan çizgisi** var: nereye ateş edeceğini gösteren kesikli
kırmızı çizgi duvara çarptığı yerde kesilir.

### Haritalar

| Harita | Boyut | Kullanan mod |
|---|---|---|
| Arena | 3400 × 2400 | FFA, Takım Savaşı |
| Royale | 4600 × 3400 | Son Hayatta Kalan |

**Her maç farklı bir haritada oynanır** ama hepsi aynı aileden: arena kaba bir
ızgaraya oturan motiflerden (L, T, U, düz duvar, sütun ikilisi) rastgele
kuruluyor, sonra sol yarı sağ yarıya aynalanıyor. Böylece yerleşim her seferinde
değişiyor ama koridorlar hep geniş ve arena hep simetrik kalıyor — tanıdık ama
ezberlenmiş değil.

Boyutlar **oransal**: `MAPS` içindeki genişlik/yüksekliği değiştirmen yeterli,
tüm yerleşim ölçeklenir.

---

## Mimari

```
shared/              sunucu ve tarayıcının ORTAK kodu
  constants.js         tüm ayarlar: modlar, sınıflar, silahlar, ağ hızları
  physics.js           hareket + çarpışma (tahmin ile sunucu birebir aynı olsun diye)
  protocol.js          mesaj tipleri ve durum paketi biçimi
  sim/                 OYUN MANTIĞININ TAMAMI — hem Node'da hem tarayıcıda çalışır
    hub.js               bağlantı/lobi yönetimi (taşımadan bağımsız)
    lobby.js             lobi durumu, ayarlar, sohbet, geri sayım, maç döngüsü
    game.js              otoriter simülasyon: hareket, mermi, hasar, alan, skor
    map.js               harita üretimi + yürünebilirlik denetimi + doğuş noktaları
    bot.js               bot yapay zekası

server/
  index.js             HTTP + WebSocket sunucusu, ana döngü, hız sınırı
  static.js            bağımlılıksız statik dosya sunucusu

public/
  js/main.js           ekranlar, menü/lobi arayüzü, PWA kurulumu
  js/net.js            taşıma vekili: WebSocket ya da tarayıcı içi
  js/local.js          ÇEVRİMDIŞI MOD — sunucuyu tarayıcıda çalıştırır
  js/game.js           tahmin, uzlaştırma, interpolasyon, HUD
  js/render.js         canvas çizimi, efektler, mini harita
  js/input.js          klavye / fare / dokunmatik
  js/sprites.js        pixel-art karakterler (kodla çizilir, dosya yok)
  js/audio.js          WebAudio ile sentezlenen sesler (ses dosyası yok)
  sw.js                service worker — internetsiz açılış
  manifest.webmanifest PWA tanımı

android/               Capacitor Android projesi (APK için)
scripts/build-www.mjs  public/ + shared/ → www/ (paketlenmiş sürüm)
.github/workflows/     GitHub'da ücretsiz APK derleme
render.yaml            ücretsiz bulut sunucu tanımı
test/                  testler
```

### Çevrimdışı mod nasıl çalışıyor?

Ayrı bir "tek kişilik oyun" kodu **yok**. Gerçek sunucudaki `Hub`/`Lobby`/`Game`
sınıflarının aynısı tarayıcıda çalıştırılıyor; sadece WebSocket yerine bellek içi
bir boru kullanılıyor (`public/js/local.js`). Oyun mantığı tek yerde durduğu için
çevrimdışı oynanış, online oynanışla birebir aynı davranır — bir modu düzeltince
diğeri de düzelir.

### "Geçilmeyen boşluk" sorunu nasıl kökten çözüldü?

Dar bir koridor oyuncunun sığamayacağı kadar daralınca oranın arkası oyun
alanından kopar. Elle göz kararı kontrol etmek yerine `analyzeWalkable()`
haritayı ızgaraya bölüp oyuncunun sığdığı hücreleri işaretliyor ve bağlı
bölgeleri çıkarıyor:

* Harita üretildikten sonra yürünebilir alanın **tek parça** olduğu doğrulanıyor.
* Royale rastgele üretildiği için kopuk çıkarsa yeni tohumla yeniden üretiliyor.
* Doğuş noktaları ve paketler yalnızca ana bölgeden seçiliyor — kimse kapalı
  bir cepte doğmuyor.
* `npm test` bu oranı her iki haritada 6 farklı tohumla ölçüyor; %0,5'ten fazla
  kopuk alan kalırsa test düşüyor. Yani bu hata bir daha sessizce geri gelemez.

### Ağ tasarımı

* **Sunucu otoriterdir.** İstemci sadece tuş maskesi + nişan açısı gönderir.
* **30 Hz** simülasyon, **20 Hz** durum paketi, **60 Hz** girdi.
* **İstemci tarafı tahmin:** kendi hareketin anında uygulanır, sunucu cevabı
  gelince onaylanmamış girdiler yeniden oynatılır; fark varsa zıplamaz, erir.
* **Varlık interpolasyonu:** diğer oyuncular 110 ms geçmişte yumuşatılarak çizilir.
* **Mermiler ışın testiyle** çözülür — hızlı mermi hedefin içinden geçmez.
* **Görüş kısıtı sunucudadır:** 1250 px'den uzak veya duvar arkasındaki düşmanlar
  istemciye hiç gönderilmez. Hem bant genişliği düşer hem duvar arkasını okuyan
  hile yazılamaz — veri istemcide yoktur.
* **Kompakt biçim:** varlıklar düz sayı dizisi olarak gider. 20 oyunculu maçta
  ölçülen trafik **istemci başına ~16 KB/sn (≈130 kbit/sn)**.
* **Hile önleme:** girdi başına `dt` üst sınırı + saniyelik hareket bütçesi,
  mesaj hız sınırı, sunucu tarafı şarjör ve atış hızı denetimi.

---

## Testler

```bash
npm test                 # fizik + 20 botla üç modun tam maç simülasyonu + WebSocket protokolü
npm run test:ws          # sadece WebSocket protokolü (ham TCP ile, kütüphanesiz)
npm run test:load        # 20 gerçek WebSocket istemcisi, bant genişliği ölçümü
npm run test:browser     # uçtan uca tarayıcı testleri (playwright gerekir)
npm run test:bundle      # APK'nın içindeki sürüm — sunucusuz çalışıyor mu?
npm run test:single      # tek dosyalık sürüm — file:// üzerinden, ağ tamamen kapalı
```

Tarayıcı testleri için: `npm i -D playwright && npx playwright install chromium`

Kapsanan senaryolar: menü → lobi → sohbet → maç → skor → maç sonu → lobiye dönüş,
21. oyuncunun reddedilmesi, dost ateşinin geçmemesi, haritada kopuk bölge
olmaması, çalıların yolu kesmemesi ve saklama kuralları, ateş edenin açığa
çıkması, canın 2 saniyede 1 dolması, cephanenin bitmesi ve kutuyla dolması,
arenanın her maçta farklı ama simetrik üretilmesi, keskin nişancı nişan
çizgisinin duvarda kesilmesi, tek atışlı silahların çubuk bırakılınca ateşlenip
basılıyken ateşlenmemesi, karakter seçiminin diğer oyunculara yansıması, tek
kişi hazır deyince maçın başlamaması ve herkes hazır olunca 5'ten geri sayması,
maçın 5 dakikada bitmesi, ağ kesildikten sonra
çevrimdışı devam,
service worker ile internetsiz açılış, telefon boyutunda dokunmatik kumanda,
paketlenmiş sürümün sunucusuz çalışması, tek dosyalık sürümün `file://` üzerinden
ağ tamamen kapalıyken tam maç oynatması ve **hiçbir dış istek yapmaması**,
güvensiz (`http://`) kaynakta uyarının çıkıp `localhost`'ta çıkmaması,
davet linkiyle tek tıkla aynı lobiye girilmesi, paketlenmiş sürümün sunucuda
yeni sürüm çıkınca haber vermesi / internetsizken sessiz kalması / "şimdi değil"
denen sürümü bir daha sormaması / GÜNCELLE sonrası tercihi hatırlaması, ayarlar panelinin açılıp
kapanması ve açıkken girdileri kilitlemesi, oyuncuların haritanın kenarında
doğmaması, uykudan uyanan sunucuda sayfanın kendini toparlaması ve sonsuz
tazeleme döngüsüne girmemesi, uyuyan sunucuya sabırla bağlanılması (3 saniyede
pes edip çevrimdışına düşmemesi), yürüyüş döngüsündeki 8 karenin hepsinin ayrı
olması, salınımın yumuşakça açılıp sönmesi, adım tozunun oluşup sönmesi,
zeminin çimen olması ve duvarların düz blok değil bina gibi çizilmesi.

WebSocket katmanı ayrıca ham TCP soketiyle 24 ayrı senaryoda sınanıyor: el
sıkışma özeti, parçalı mesaj birleştirme, bayt bayt gelen çerçeveler, 16/64 bit
uzunluk yolları, `maxPayload` aşımı, ping/pong, kapanış el sıkışması, maskesiz
çerçevenin reddi, ani kopmada bağlantının temizlenmesi ve 30 eşzamanlı istemci.

---

## Ayarları değiştirme

Neredeyse her şey **`shared/constants.js`** içinde:

* `MAX_PLAYERS` — lobi kapasitesi (varsayılan 20)
* `MATCH_MS` — maç süresi (varsayılan 5 dakika, üç mod da bunu kullanır)
* `MODES.*.scoreLimit` — kazanma için gereken öldürme sayısı
* `MAPS` — harita boyutları (yerleşim oransal olduğu için tek değişiklik yeter)
* `BUSH_REVEAL_DIST` — çalıdaki oyuncunun görünür olduğu mesafe
* `BUSH_FIRE_REVEAL_MS` — ateş edince ne kadar süre açıkta kalınacağı
* `HP_REGEN_PER_SEC` — canın saniyede ne kadar dolduğu (0.5 = 2 sn'de 1 can)
* `WEAPONS.*.reserve` — silahın yedek mermi havuzu
* `AMMO_PACK_FRACTION` — cephane kutusunun doldurduğu oran
* `CLASSES` / `WEAPONS` — can, hız, hasar, atış hızı, şarjör, menzil
* `ZONE` — daralan alanın hızı, evre sayısı, hasarı
* `VIS_DIST` — düşmanı görebildiğin mesafe
* `SPAWN_EDGE_INSET` — haritanın kenarındaki doğuşa kapalı şeridin genişliği
* `SPAWN_CENTER_BIAS` — doğuş seçilirken merkeze yakınlığın ağırlığı

Sunucu ve istemci aynı dosyayı okur; sunucuyu yeniden başlatıp sayfayı yenilemen
yeterli. (PWA'da güncellemenin gelmesi için uygulamayı bir kez kapatıp açman
gerekebilir — service worker yeni sürümü arka planda indirir.)

Haritayı değiştirmek için `shared/sim/map.js` → `buildArena()` içindeki dikdörtgen
listesi (sol yarısı yazılır, sağ yarı otomatik aynalanır). Spawn noktaları
haritadan otomatik hesaplanır, elle güncellemen gerekmez.

---

MIT lisansı. İyi eğlenceler — ve iyi nişanlar. 🎯
