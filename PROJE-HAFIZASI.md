# Savaş Arenası — Proje Hafızası

Bu belge, projenin **tek noktadan hatırlanması** için yazıldı. Sohbet
silinse, bilgisayar değişse, aradan aylar geçse bile buradan devam edilebilir:
ne yaptığımız, neden öyle yaptığımız, hangi hataların kökünü nerede bulduğumuz
ve nasıl derlenip dağıtıldığı burada.

> Kod içindeki yorumlar da bilerek ayrıntılı: her önemli kararın **neden** öyle
> olduğu ilgili dosyanın içinde yazıyor. Bu belge onların üstünde duran harita.

---

## 1. Proje nedir

**Savaş Arenası** — lobili, her lobide en fazla **20 kişilik**, 2D tepeden
bakış çok oyunculu savaş oyunu. Tarayıcıda çalışır, telefona uygulama olarak
kurulur, internetsiz de oynanır.

- Üç mod: Herkes Herkese (ffa), Takım Savaşı (tdm), Son Hayatta Kalan (br)
- Her maç 5 dakika, her maçta yeni üretilen harita
- Dört sınıf: Komando, Akıncı, Keskin Nişancı, **Bombacı**
- Sekiz karakter görünümü, hepsi kodla çiziliyor (hazır görsel dosyası yok)
- Botlar: kolay / orta / zor
- Çevrimdışı mod: oyun sunucusu cihazın içinde çalışır

**Dil:** kod, yorumlar, arayüz ve testler **Türkçe**.

---

## 2. Kullanıcı ve çalışma biçimi

- Kullanıcı: **Nuri**, Türkçe konuşuyor, Windows 11 kullanıyor.
- Terminal ve GitHub konusunda yeni — talimatlar **adım adım ve somut**
  verilmeli ("şu düğmeye bas, şurada şunu göreceksin").
- İstediği çalışma biçimi:
  - ilerleme **yüzde ve dolan çubukla** bildirilecek (`███░░ %28` gibi)
  - iş bitince **ses** çıkarılacak (`printf '\a'`)
  - iş bitince **ekran görüntüsü** verilecek
- Değişmez kural: **kök nedeni düzelt, hızlı yama yapma, gerekiyorsa zaman
  harca.** Bu belgedeki "çözülen hatalar" bölümü bu kuralın ürünü.

---

## 3. Mimari — üç cümlede

1. **Sunucu otoriterdir.** İstemci sadece tuş maskesi + nişan açısı gönderir;
   bütün kararlar sunucuda verilir.
2. **Simülasyon kodu tektir** (`shared/sim/`). Aynı kod hem Node sunucusunda
   hem de çevrimdışı modda tarayıcının içinde çalışır. Bu yüzden çevrimdışı
   oynanış online ile birebir aynıdır ve "iki ayrı oyun" bakımı yoktur.
3. **Dış paket yok.** Sunucunun çalışması için `npm install` gerekmez —
   WebSocket katmanı dahil her şey depoda (`server/ws.js`).

### Ağ

- 30 Hz simülasyon · 20 Hz durum paketi · 60 Hz girdi
- İstemci tarafı tahmin + sunucuyla uzlaştırma
- Varlık interpolasyonu: diğer oyuncular 110 ms geçmişte yumuşatılır
- Görüş kısıtı **sunucudadır**: 1250 px'den uzak veya duvar arkasındaki düşman
  istemciye hiç gönderilmez (hem bant hem hile önleme)
- Durum paketleri **ikili** (bkz. bölüm 6)

---

## 4. Dosya haritası

```
shared/           İki tarafın da kullandığı kod
  constants.js      Bütün ayarlar: sınıflar, silahlar, harita, bot seviyeleri
  protocol.js       Mesaj tipleri + durum paketi alan sayıları
  physics.js        Çarpışma, hareket, ışın testleri
  binary.js         Durum paketinin ikili biçimi (kodla/çöz)
  sim/
    hub.js            Bağlantılar, lobiler, mesaj yönlendirme
    lobby.js          Tek bir lobi: üyeler, hazır durumu, geri sayım, maç döngüsü
    game.js           Otoriter simülasyon (hareket, ateş, hasar, bomba, asist)
    map.js            Harita üretimi + yürünebilirlik analizi
    bot.js            Bot yapay zekâsı (zorluk seviyeleri burada uygulanır)

server/           Sadece Node tarafı
  index.js          HTTP + WebSocket sunucusu, tick döngüsü
  ws.js             Sıfır bağımlılıklı WebSocket (RFC 6455) sunucusu
  static.js         Statik dosyalar, /surum.json, /sw.js, /paket.zip
  stamp.js          İçerik damgası (sürüm karşılaştırması bundan)

public/           Tarayıcıya giden her şey
  index.html, css/style.css
  js/main.js        Menü/lobi arayüzü, ağ olayları, güncelleme akışı
  js/game.js        İstemci maç mantığı, HUD, tahmin
  js/render.js      Canvas çizimi
  js/input.js       Klavye/fare/dokunmatik
  js/net.js         Taşıma katmanı (WebSocket / bellek içi)
  js/local.js       Çevrimdışı mod: sunucuyu tarayıcının içinde çalıştırır
  js/sprites.js     Karakter ve silah çizimi
  js/audio.js       Sesler (kodla üretiliyor)

scripts/
  build-www.mjs     www/ klasörünü üretir (APK ve statik host için)
  build-single.mjs  Tek dosyalık HTML sürümü
  make-bundle.mjs   dist/paket.zip (kendini güncelleme paketi)
  make-icon.mjs     Simgeleri üretir (web + Android, tek kaynaktan)
  make-texture.mjs  Çim dokusunu hazırlar
  serve-www.mjs     www/ için düz statik sunucu (test amaçlı)

assets/icon-source.png   Simgenin kaynağı (kullanıcının verdiği görsel)
android-icons/           Üretilmiş Android launcher simgeleri
.github/workflows/android.yml   APK derleme (push'ta kendiliğinden)
test/                    28 test takımı
```

---

## 5. Sürüm damgası — en kritik mekanizma

`server/stamp.js` → `public/` ve `shared/` klasörlerinin içeriğinden SHA-256
üretip ilk 12 karakterini alır. **Üç yer de aynı işlevi kullanır:**

- sunucu → `/surum.json`
- `build-www.mjs` → `www/index.html` içine `window.__BUILD__`
- `build-single.mjs` → tek dosya sürümüne

Üretilen dosyalar damgaya **dahil değildir** (`sw.js`, `savas-arenasi.html`,
`surum.json`, `dist/paket.zip`). Dahil olsalardı her derlemede damga değişir
ve uygulama sonsuza kadar "yeni sürüm var" derdi.

Uygulama açılışta kendi damgasını `/surum.json` ile karşılaştırır; farklıysa
**GÜNCELLEME VAR** ekranı çıkar.

---

## 6. İkili durum paketi (`shared/binary.js`)

Sunucudan çıkan verinin **%100'ü** durum paketleridir. JSON'da baytların çoğu
oyun bilgisi değil ambalajdır (alan adları, tırnaklar, virgüller).

**Ölçülen kazanç** — 20 kişilik dolu maç, 25 sn, gerçek sunucu:

| | JSON | İkili |
|---|---|---|
| Toplam | 10,17 MB | **2,76 MB** |
| İstemci başına | 20,8 KB/sn | **5,6 KB/sn** |

**3,7 kat küçülme.** Paket sayısı ve içeriği aynı.

**Tasarım ilkesi:** bu katman *sadece bir ambalajdır*. `coz(kodla(x))` her
zaman `x` ile birebir aynı nesneyi verir — hassasiyet düşürülmez, alan
atılmaz. `test/binary.mjs` bunu 7000'den fazla gerçek maç paketiyle sınar.

Kazanç nereden: alan adları hiç gönderilmiyor · sayılar ikili · numaralar fark
olarak (zigzag varint) · türetilebilir alanlar atlanıyor (azami can sınıftan,
şarjör silahtan belli) · bayrak+sınıf tek baytta.

**Eski istemciler bozulmaz:** istemci `hello` mesajında `bin: 1` diyerek
yeteneğini bildirir; demeyene JSON gider.

**Güvenlik ağı:** kodlayıcı beklenmedik değerde hata fırlatır, `hub.send`
yakalayıp JSON'a düşer. En kötü ihtimal "kazanç olmadı", asla "oyuncular
ışınlandı" değil.

---

## 7. Uygulama kendini nasıl günceller

**Bir kere kur, bir daha kurma.** GÜNCELLE'ye basınca Android'in kurulum
ekranı açılmaz; uygulama sunucudan yeni web paketini indirip kendi içindekinin
yerine koyar.

1. `scripts/make-bundle.mjs` → `www/` → `dist/paket.zip`
   (ZIP biçimi elle yazıldı: dış paket eklemeden, sıkıştırma Node'un zlib'inde)
2. Sunucu `/paket.zip` adresinden verir (damgaya dahil değil)
3. Uygulama `/surum.json` ile damga karşılaştırır
4. GÜNCELLE → `@capgo/capacitor-updater` indirir, kurar, uygulama yenilenir

**Güvenlik ağları:**
- Yeni sürüm açılınca `notifyAppReady()` çağrılır; 10 sn içinde çağrılmazsa
  eklenti eski sürüme geri döner (bozuk güncelleme telefonu kilitleyemez)
- İndirme patlarsa kullanıcıya "tekrar dene" denir, oyun kendi kopyasıyla
  oynanmaya devam eder
- Eklenti yoksa eski davranışa düşülür (sunucudaki web sürümüne git)

**Sınırı:** oyunun İÇERİĞİ güncellenir. Uygulama adı, simge, izinler gibi
Android tarafını ilgilendiren şeyler yine yeni APK ister.

> ⚠ **Henüz gerçek telefonda denenmedi.** Bu ortamda Android SDK'ya erişim
> kapalı (Google sunucuları engelli), APK derlenemiyor. Karar mantığının
> tamamı test edildi (`test/browser-selfupdate.mjs`) ama native indirmenin
> ilk gerçek denemesi kullanıcının telefonunda olacak.

---

## 8. Çözülen kök nedenler

Bu bölüm projenin en değerli kısmı: her biri **belirtiyi değil sebebi**
düzeltti.

| Belirti | Kök neden | Çözüm |
|---|---|---|
| Telefonda internetsiz açılmıyor | Service worker sadece https/localhost'ta çalışır; `http://192.168…` güvensiz sayılır | Tek dosyalık HTML sürümü + güvensiz kaynakta uyarı |
| `npm start` → `ERR_MODULE_NOT_FOUND: 'ws'` | Dış paket bağımlılığı | Sıfır bağımlılıklı `server/ws.js` yazıldı |
| Oyuncular listede asılı kalıyor | Karşı taraf TCP'yi yarım kapatınca (`FIN`) soket yarı açık kalıyor, `close` hiç gelmiyor | `socket.on('end')` ile kapatma tamamlanıyor |
| Mobil veriden bağlanılamıyor | 3 sn sonra çevrimdışına düşülüyordu; uyuyan bulut sunucu 1 dk uyanıyor | Sabır 45 sn, `/health` ile uyandırma, "beklemeden oyna" düğmesi |
| "adresine ulaşılamıyor" (adres boş) | Paketlenmiş sürümde "boş adres = bu sayfanın sunucusu" varsayımı | `resolveServerUrl()` — pakette boş adres bulut sunucuya çözülüyor |
| APK "Bağlanılıyor: localhost"ta takılıyor | Capacitor dosyaları `https://localhost`tan veriyor; protokole bakmak yetmiyor | Ölçüt `__BUNDLED__` oldu; kendi adresi sunucu sayılmıyor |
| **APK açılınca Chrome'a atıyor** | Bir kez GÜNCELLE denince tercih kalıcı; her açılışta dış adrese `location.replace` → Android bunu dışarı sayıp Chrome'da açıyor | Adres `allowNavigation`a eklendi + yönlendirme öncesi sunucu erişilebilir mi diye sorulur + yönlendirme dışarı açılırsa tercih kendiliğinden silinir |
| Yeni APK'da eski sürüm çalışıyor | `https://localhost` güvenli kaynak sayıldığı için APK'da service worker kaydoluyordu, eski dosyalar önbellekten geliyordu | Paketlenmiş sürümde SW kaydedilmiyor, varsa her açılışta sökülüyor |
| "Lobiye dön"de aynı ekran ikinci kez | Skor tablosu iki ayrı yerden gösteriliyordu (maç sonu + lobi) | Her tabloya maç numarası; görülen tablo lobide tekrar gösterilmiyor |
| Çimen bazen yüklenmiyor | Zemin 512 px parçalara **bir kez** çizilip saklanıyor; doku geç indiyse parçalar yedek çimenle pişip kalıyordu | Doku gelince parça önbelleği boşaltılıyor + doku menüdeyken yüklenmeye başlıyor |
| Oyun kasıyor (27,6 ms/kare) | Her karede desen dönüşümü + 34 radyal gradyan + bina gölgeleri | Desen önceden ölçekleniyor, lekeler pişiriliyor, dünya parçalara bölünüp önbelleğe alınıyor → **~11 ms** |
| Bombanın menzili ayarlanamıyor (telefon) | Nişan çubuğunu tutmak = ateş tuşunu tutmak; nişan alma süresi menzili dolduruyordu | Telefonda menzil **çubuğun itilme miktarından** geliyor (`mag` alanı; `dx/dy` normalize edildiği için büyüklük kayboluyordu) |
| Bomba parmak kalkmadan atılıyor (telefon) | Ateş bayrağı çubuğun itilme miktarına bağlıydı (`len > 20`); menzili kısaltmak için parmak merkeze çekilince "parmak kalktı" sanılıyordu | Atılabilir silahta ateş = parmak basılı; itilme yalnızca menzili belirler |
| APK "Uygulama yüklenmedi" diyor | Debug imzası her derlemede yeniden üretiliyordu (GitHub makineleri sıfırdan kuruluyor); Android aynı pakete farklı imzayı kabul etmez | Depoya sabit `android-config/debug.keystore` kondu, derleme onu kullanıyor |
| Bomba nişangâhı takip etmiyor (bilgisayar) | Menzil tutma süresinden geliyordu, imlecin yeri hiç hesaba katılmıyordu | Menzil **imlecin uzaklığından** hesaplanıyor → bomba nişangâhın olduğu yere düşer |
| APK'nın simgesi alakasız | `npx cap add android` kendi varsayılan simgesini koyuyor, Android'e simge verilmemişti | `scripts/make-icon.mjs` tek kaynaktan bütün boyutları üretiyor, derlemede kopyalanıyor |
| **Duvar var ama içinden geçiliyor** ("bozuk duvar") | Sabit dünya katmanı 512 px parçalar hâlinde önbelleğe alınıyor; önbelleğin kimliği sadece `${map.w}x${map.h}` idi. Arena her maçta yeniden üretiliyor ama **boyutu hep aynı** → kimlik değişmiyor, önbellek temizlenmiyordu. Sonraki maçta ekranda ÖNCEKİ haritanın duvarları görünüyor, çarpışma YENİ haritaya göre işliyordu. En fazla 40 parça saklandığı için sadece bazı bölgelerde oluyordu — "bazen" denmesinin sebebi bu | Kimlik `mapSignature(map)` ile engellerin/çalıların geometrisinden üretiliyor; bir duvar bir piksel kaysa imza değişir. `test/browser-hayaletduvar.mjs` düzeltme geri alınınca düşüyor (doğrulandı) |
| "BAŞLA!" göz kırpması kadar duruyor **ve alttaki yazının üstüne biniyor** | İkisi de tek sebepten: sayı sıfıra inince "BAŞLA!" yazılıyor ama sunucu tam o anda maçı başlatıyordu → yazı ~50 ms görünüyordu. Görünen o tek kare de vuruş (pop) animasyonunun `scale(1.6)` başlangıcıydı; 190 px'lik geniş bir kelime bir anlığına 304 px'e çıkıp altındaki "MAÇ BAŞLIYOR" satırını örtüyordu | Geri sayıma `COUNTDOWN_GO_MS = 1000` eklendi (sunucu 6000 ms sayıyor, ekranda 5→1 sonra 1 sn "BAŞLA!"); kelime kipinde punto `11vw` (rakam `22vw` idi), satır yüksekliği 1,25 ve vuruş `scale(1.10)` |
| **Mermi silahtan değil adamdan çıkıyor** | İki ayrı hesap vardı: sunucu mermiyi oyuncunun TAM MERKEZİNDEN 22 px ileriden doğuruyordu (`PLAYER_RADIUS + 6`), istemci ise silahı gövdenin 18,4 px yukarısına / 5 px yanına / 32 px ileriye çiziyordu. Aradaki fark gözle görülüyordu | Tek kaynak: `muzzleWorld()` + `WEAPON_VIEW` (shared/constants.js). Çizim de mermi de aynı noktayı kullanıyor. Namlu ileri kaydığı için "duvara dayanıp ateş edince mermi duvarın ötesine doğar mı" riski doğdu; `namluyuDuvarinIcineSokma()` gövdeden namluya doğru ilerleyip duvara girmeden önceki son boş noktayı seçiyor. `test/namlu.mjs` |
| **Kendimi öldürebiliyorum** (bombacı) | Patlama, atan kişiyi de kapsıyordu ("yakına atmak riskli olsun" diye). Dar koridorda/köşede bombacı kendini öldürüyordu | `explode()` artık `p.id === b.owner` olanı atlıyor: kendi bomban sana hiç dokunmuyor. Düşmana hasar aynı. `test/patlama.mjs` |
| **Mobilde bombanın nereye gittiği görünmüyor** | Telefonda yakınlaştırmanın alt sınırı 0,62'ydi; bombanın azami menzili (675 px) 900 px'lik bir telefon ekranının tam kenarına denk geliyordu, hedef halkası ekran dışında kalıyordu | Alt sınır **0,50**. Görüş alanı ~%38 genişledi, halka rahatça içeride. Bilgisayarda alt sınır hiç devreye girmiyor, orası değişmedi |
| Touchscreen dizüstünde dokunmatik arayüz | Dokunma yeteneği varlığı ölçüt alınmıştı | Son kullanılan girdi + `(any-pointer: fine)` ölçütü |

### Testlerin kendi kusurları (ürün değil)

Bunlar da kök nedeniyle düzeltildi, çünkü sahte hata gerçek hatayı gizler:

- Skor listesi alan sayısı testlerde **sabit yazılmıştı**; asist eklenince
  yanlış saydılar → artık protokolden okuyor
- Nişancı testi cephaneyi sıfırlarken oyuncu tesadüfen cephane kutusuna
  basıyordu → ölçüm sırasında kutular kapatılıyor
- Gündüz/gece testi parlaklığı tam da lambanın olduğu yerden ölçüyordu →
  ölçüm lambanın dışına alındı
- Bomba testi rastgele haritada duvara denk gelince patlıyordu → ölçüm öncesi
  oyuncu açık koridora taşınıyor
- Gölge testi ekran kenarındaki **vinyet** yüzünden sistematik fark ölçüyordu
  (kamera harita kenarında sabitlenince oyuncu ortada olmuyor) → oyuncu
  ortada değilse o maç ölçülmüyor; ayrıca yönlü gölge **tutarlıdır**, zemin
  lekesi değildir — birden çok maçta işaret tutarlılığına bakılıyor
- Toplu test listesine üç yeni test eklenmemişti; tek tek geçiyorlardı ama
  turda hiç çalışmıyorlardı → liste tamamlandı

---

## 9. Oyun ayarları (`shared/constants.js`)

**Sınıflar**

**CAN HERKESTE 100.** Eskiden sınıflar farklı canlıydı (78–100); kullanıcı
isteğiyle eşitlendi. Artık tek fark hız ve silah.

| Sınıf | Can | Hız | Silah |
|---|---|---|---|
| Komando | 100 | 218 | Tüfek |
| Akıncı | 100 | 282 | Pompalı |
| Keskin Nişancı | 100 | 176 | Keskin Tüfek |
| Bombacı | 100 | 202 | Bomba |

**Silahlar (şarjör/yedek)** — tüfek 30/60 · pompalı 5/15 · keskin 5/15 ·
bomba **6**/15

**Silahın elde durduğu yer** `WEAPON_VIEW` + `muzzleWorld()` ile tek yerde
tanımlı. Mermi buradan doğuyor, namlu alevi burada çakıyor, keskin nişancının
kırmızı çizgisi buradan başlıyor. Bombacının elinde ateşli silah YOK: namlu
uzunluğu 3 px ve çizimde tüfek yerine bomba var (`drawBombInHand`), yani bomba
elden çıkıyor.

**Bomba:** menzil 143–675 · hız 1050 · patlama yarıçapı **100** · patlama hasarı 56 ·
doğrudan isabet hasarı **yok**. Patlama duvarı delmez, dost ateşi geçmez ve
**kendi bombandan zarar görmezsin**. Şarjör 6, yedek 15.

Bombacı iki kez ayarlandı: önce zayıflatıldı (menzil/hasar/alan yarıya, hız
1,5×), sonra güçlendirildi (**menzil +%50, hız +%25, patlama hasarı +%50,
patlama alanı +%50**), en son patlama alanı %20 küçültüldü (125 → **100**).
Asgari menzil (143) yarıçaptan büyük: atılan bomba hep kendinden uzağa düşer.
`test/browser-bomb.mjs` bu ilişkiyi de sınıyor.

**Bot seviyeleri:** kolay (yetenek 0,12–0,34 · görüş 780 · tepki 520 ms) ·
orta (0,42–0,68 · 1150 · 220 ms) · zor (0,78–0,98 · 1400 · 90 ms).
Tek sayı değil **aralık** veriliyor ki aynı zorluktaki botlar birbirinin
kopyası olmasın.

**Asist:** son 9 saniyede hasar veren herkes (öldüren ve kurban hariç) asist
alır — `ASSIST_WINDOW_MS`.

**Öldürme ödülü:** `KILL_HEAL = 50`. Birini öldüren oyuncu 50 can kazanır ama
**canı taşmaz**: 90 canlıyken öldüren 140 değil 100 olur. Kendini öldürene ve
alan hasarıyla ölene ödül yok; aynı anda ölen (artık hayatta olmayan) öldüren
de ödül almaz. `test/oldurme-cani.mjs` bu tavanı 15 kontrolle koruyor —
kullanıcının açık uyarısıydı, ileride ödül değişse bile tavan yerinde kalmalı.

**Lobi kuralları**

- `MIN_FIGHTERS = 2` — maça girecek toplam kişi (oyuncular + botlar) en az
  iki olmalı. **Tek başına maç başlatılamaz.** Kural sunucuda
  (`Lobby.startBlockReason()`), arayüzde değil; arayüz sadece sebebi ekranın
  ortasında kırmızı bir kutuda gösteriyor (`#centerWarn`).
- **Kurma ekranında artık sadece lobi adı, gizlilik ve KUR düğmesi var.**
  Oyun modu, kapasite, bot sayısı ve bot zorluğu — dördü de **lobinin içine**
  taşındı. Aynı ayarın iki ekranda birden durması "hangisi geçerli" sorusunu
  doğuruyordu. Lobi varsayılan modla, 20 kapasiteyle ve **0 botla** açılır.
- Mod açıklamaları (`.mode-picker` üstündeki `compact` sınıfı kaldırıldı) artık
  seçimin yapıldığı yerde, lobide görünüyor.
- **Lobi sohbeti kaldırıldı.** Sunucu sistem mesajı üretmeye devam ediyor;
  `renderChat`/`appendChat` öğe yoksa sessizce çıkıyor, geri açmak için tek iş
  HTML'e paneli koymak. Lobi tek sütun oldu (`.lobby-wrap`, 820 px).
- Menüde paneller **tek gövde**: kimlik paneli (ad + çevrimdışı/online) ile
  altındaki panel(ler) dikey olarak birleşik, çevrimdışında sağdaki "Açık
  Lobiler" olmadığı için Lobi Kur tüm genişliği alıyor (`.menu-cols.tek`).
- "Çevrimdışı Mod" açıklama paneli, alttaki **Tam ekran** düğmesi, ayarlar
  panelindeki **Tam ekran** ve alttaki tuş açıklaması (`footer.hint`) kaldırıldı.

**Birleşme yerindeki "çizgi" — ölçülerek çözülen görsel hata**

Paneller birleştirilince aralarında ince koyu bir çizgi görünüyordu. Kenarlık
değildi: alttaki panelin **kendi gölgesi** (`0 10px 30px`) 30 piksellik
bulanıklıkla YUKARI da taşıyor ve DOM'da sonra geldiği için üstteki panelin alt
kenarını karartıyordu. Kenarlıkları, degradeleri ve iç ışıkları sıfırlamak
yetmedi; gölge kaldırılınca bitti. Ölçüm: birleşme yerindeki komşu satır farkı
**12 → 0** (hem 1200 px hem 420 px ende).
- Bot sayısı 0 iken zorluk menüsü gri ve tıklanamaz (`.level-picker.disabled`).
- `COUNTDOWN_MS = 6000`, `COUNTDOWN_GO_MS = 1000`: ekranda 5→1 sayılır, sonra
  "BAŞLA!" tam bir saniye durur, maç ondan sonra başlar.

**Maç sonu**

Kazanan ve kaybeden aynı akışı görüyor: önce **sadece** sonuç yazısı
(`WIN_SOLO_MS = 2000`), sonra skor tablosu. Kazananda sarı **KAZANDIN** +
konfeti, kaybedende kırmızı **KAYBETTİN** (konfetisiz). İki yazı da aynı CSS
sınıfından (`.win-text`) besleniyor — punto, yazı tipi ve animasyon tek yerde;
sadece renk farklı. Skor tablosu yazının üstüne binmiyor, ikisi hiç aynı anda
ekranda olmuyor.

**Renk paleti:** "Bakır & Kömür" — koyu kömür zemin (`--bg #0a0e13`), bakır
turuncu vurgu (`--accent #ff8a3d`), panel üstünde soldan sağa sönen bakır şerit.
Bütün renkler `:root` içinde tek yerde; paleti değiştirmek için orayı
değiştirmek yeterli. (Asker Yeşili ve Gece Mavisi seçenekleri de üretildi,
kullanıcı bakırı seçti — `scripts/onizleme-renk.mjs` üçünü de yeniden
fotoğraflayabilir.)

**Kamera:** yakınlaştırma `clamp(min(en,boy)/900, 0.50, 1.15)`. Alt sınır
telefonu ilgilendiriyor; `scripts/onizleme-kamera.mjs` kademeli önizleme üretir.

**Kaldırıldı:** gün döngüsü, gölgeler, Ağır Piyade sınıfı, maç içi sohbet
görünürlüğü, lobi sohbeti, kurma ekranındaki mod/kapasite/bot ayarları.

---

## 10. Komutlar

```bash
npm start                # sunucu (kurulum gerekmez)
npm test                 # fizik + simülasyon + WebSocket + ikili paket
npm run test:browser     # bütün tarayıcı testleri (playwright gerekir)
npm run build:single     # dist/savas-arenasi.html (tek dosya)
npm run build:www        # www/ (APK ve statik host)
npm run build:bundle     # www/ + dist/paket.zip (kendini güncelleme)
npm run icons            # simgeleri yeniden üret
npm run android:apk      # yerel APK (Android Studio gerekir)
```

Tarayıcı testleri için: `npm i -D playwright && npx playwright install chromium`

**Test sunucuları:** `localhost:3000` (oyun sunucusu) ve `localhost:3100`
(`npm run serve:www`). Testler bunlara bağlanır; ayakta değillerse toplu tur
sahte hata verir — bu tuzağa birkaç kez düşüldü.

---

## 11. Dağıtım

### Sunucu (Render, ücretsiz)

`render.yaml` hazır. Depoyu Render'a bağlamak yeterli.
Kurulum komutu `www/` ve `dist/paket.zip` üretir.

Ücretsiz plan notları:
- 15 dk boş kalınca uyur, ilk giren ~1 dk bekler (oyun bunu sabırla karşılar)
- **Aylık 5 GB veri** dahil; aşınca kart tanımlı değilse servis ay sonuna
  kadar durur, fatura çıkmaz
- İkili paketle 20 kişilik maç ayda ~26 saat sürer

### APK (GitHub Actions)

1. Dosyaları depoya yükle → derleme **kendiliğinden başlar** (push tetikleyici)
2. Actions → yeşil tik → altta **Artifacts** → `savas-arenasi-apk`
3. Zip'ten çıkan APK'yı telefona kur

**Dikkat:** yeni APK kurmadan önce eskisini kaldır (ya da uygulama verilerini
temizle) — eski webview verisi karışabilir.

`android/` klasörü depoda yok; Capacitor onu derleme sırasında üretiyor.
Simgeler `android-icons/`ten kopyalanıyor.

---

## 12. Testler (32 takım)

Kapsam özeti: menü → lobi → sohbet → maç → skor → maç sonu → lobiye dönüş ·
21. oyuncunun reddedilmesi · dost ateşi · harita kopukluğu · çalı kuralları ·
can/cephane · nişan çizgisi · karakter seçimi · geri sayım ve **İPTAL** ·
maç süresi · ağ kesintisinde çevrimdışına devam · service worker · dokunmatik
kumanda · paketlenmiş sürüm · tek dosya sürümü (`file://`, ağ kapalı, **hiç
dış istek yok**) · güvensiz kaynak uyarısı · davet linki · güncelleme akışı ·
ayarlar paneli · doğuş noktaları · uyuyan sunucu · soğuk açılış · yürüyüş
animasyonu · zemin/bina görünümü · **ikili paket birebir eşitliği** · **eski
istemci uyumluluğu** · **gerçek APK ortamı** · **çim geç yüklenmesi** ·
**bomba menzili ve kuru kafa** · **asist / sohbet / İPTAL** · **kendini
güncelleme** · **gün döngüsünün kaldırıldığı** · **hayalet duvar (bayat parça
önbelleği)** · **lobi kuralları: tek başına başlatma engeli, bot varsayılanı,
zorluk menüsünün grileşmesi, BAŞLA! süresi/çakışması, KAYBETTİN** ·
**öldürme ödülünün canı taşırmaması** · **merminin namludan doğması ve
bombacının elinde tüfek olmaması** · **patlama kuralları (kendi bombandan zarar
görmeme, dost ateşi, duvar, doğuş koruması)**

WebSocket katmanı ayrıca ham TCP soketiyle 24 senaryoda sınanıyor.

---

## 13. Bilinen sınırlar

- Bu geliştirme ortamında Android SDK / Maven / Gradle indirmeleri **engelli**;
  APK yalnızca GitHub Actions'ta derlenebiliyor
- Render ücretsiz planı: uyuma + aylık 5 GB veri
- 900 kişi gibi ölçekler için sunucunun çok işlemli hâle getirilmesi gerekir
  (ölçüm: 45 lobi ≈ 2,5–3 çekirdek, saatte ~63 GB veri)

---

## 14. Nerede kaldık

- **Kendini güncelleme GERÇEK TELEFONDA ÇALIŞTI** (20 Ağustos 2026). Uzun süre
  "burada denenemez" diye açık kalan tek madde buydu; kapandı. Sabit imzalı APK
  de sorunsuz kuruldu, "Uygulama yüklenmedi" hatası tekrarlamadı.
- **Tek başına maç engeli ve ekran ortası uyarısı telefonda doğrulandı.**
- Son sürüm damgası: **995bb3e0532d** — 32 test takımının tamamı geçiyor
  (26 tarayıcı + 6 node)
- Kullanıcının yapması gereken: zip'i GitHub'a yükle → Actions'ın ürettiği
  APK'yı kur (eskisini kaldırdıktan sonra)
- Sonraki adım: kendini güncellemenin gerçek telefonda denenmesi

### GitHub'a yükleme: 100 dosya sınırı

GitHub'ın web arayüzü **tek seferde en fazla 100 dosya** kabul ediyor.
Depo 99'a dayanmıştı — bir dosya daha eklense yüklenemeyecekti.

**Yapılan:** `android-icons/` (16 dosya) depodan çıkarıldı. O klasör zaten
`assets/icon-source.png`den **üretiliyor** (`scripts/make-icon.mjs`) ve üretim
birebir tekrarlanabilir — aynı kaynaktan her zaman aynı baytlar çıkıyor
(doğrulandı). Derleme akışına "Simgeleri üret" adımı eklendi, `.gitignore`a
`android-icons/` yazıldı. Depo **99 → 83 dosya**.

Neden `public/icons` da çıkarılmadı: o klasör **sürüm damgasına** giriyor
(`server/stamp.js` `public/` ve `shared/` altını hashliyor). Üretim
tekrarlanabilir olsa da damgayı üreten üç yerin (sunucu, www paketi, tek dosya)
birbirinden ayrılma riskini almaya değmez — bedeli 6 dosya.

Sınıra tekrar dayanılırsa: **iki parça hâlinde yükle**. Önce bir kısmını
sürükleyip *Commit changes*, sonra kalanı. Her commit ayrı sayılır, sınır
sıfırlanır; son commit derlemeyi başlatır.

Kalıcı çözüm **GitHub Desktop**: klasörü bir kez bağlarsın, sonra her
değişiklikte tek düğmeyle gönderirsin — dosya sayısı sınırı yoktur.

`test/` klasörünü (32 dosya) çıkarmak da *teknik olarak* mümkün — ne Render ne
de APK derlemesi ona bakıyor — ama **önerilmez**: testler projenin hafızası,
kaybolurlarsa aynı hatalar geri gelir.
