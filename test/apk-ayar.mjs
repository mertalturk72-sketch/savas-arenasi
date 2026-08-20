// APK derleme ayarlarının TUTARLILIĞI.
//
// Bu dosyalar birbirine bağlı ama farklı yerlerde duruyor; biri değişip
// diğeri unutulunca hata ancak GitHub'da derleme yapılıp APK telefona
// kurulduktan sonra fark ediliyor — yani en pahalı yerde. Burada, hiçbir şey
// derlemeden, saniyeler içinde yakalıyoruz.
//
// Sınananlar:
//   • capacitor.config.json'daki appId ile MainActivity.java'nın paketi aynı mı
//   • derleme akışı MainActivity'yi appId'ye uyan YOLA kopyalıyor mu
//   • tam ekran (sistem çubuklarını gizleme) kodu gerçekten orada mı
//   • simge paketi ve sabit imza anahtarı yerinde mi, akışta kullanılıyor mu
//
// Çalıştır:  node test/apk-ayar.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const varMi = (p) => fs.existsSync(path.join(ROOT, p));

const hatalar = [];
let sayac = 0;
function kontrol(baslik, ok, ek = '') {
  sayac++;
  console.log(`  ${ok ? '✓' : '✗'} ${baslik}${ek ? ' — ' + ek : ''}`);
  if (!ok) hatalar.push(baslik + (ek ? ' — ' + ek : ''));
}

const cfg = JSON.parse(oku('capacitor.config.json'));
const akis = oku('.github/workflows/android.yml');

// ===== 1) appId ↔ MainActivity paketi ====================================
console.log('1) Paket adı');
kontrol('capacitor.config.json appId var', !!cfg.appId, cfg.appId);
kontrol('android-config/MainActivity.java var', varMi('android-config/MainActivity.java'));

if (varMi('android-config/MainActivity.java')) {
  const java = oku('android-config/MainActivity.java');
  const m = java.match(/^\s*package\s+([\w.]+)\s*;/m);
  const paket = m ? m[1] : null;
  kontrol('MainActivity paketi appId ile aynı', paket === cfg.appId,
    `java=${paket} · appId=${cfg.appId}`);

  // ===== 2) Tam ekran kodu =============================================
  console.log('2) Tam ekran');
  kontrol('BridgeActivity genişletiliyor', /extends\s+BridgeActivity/.test(java));
  kontrol('sistem çubukları gizleniyor', /\.hide\(\s*WindowInsetsCompat\.Type\.systemBars\(\)\s*\)/.test(java));
  kontrol('kenardan kaydırınca geçici geliyor',
    /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/.test(java));
  kontrol('odak dönünce tekrar uygulanıyor', /onWindowFocusChanged/.test(java));
  // Kullanılan her androidx sınıfı içe aktarılmış mı? (derleme hatasının
  // en sık sebebi eksik import.)
  for (const sinif of ['WindowCompat', 'WindowInsetsCompat', 'WindowInsetsControllerCompat']) {
    kontrol(`${sinif} içe aktarılmış`, new RegExp(`import\\s+androidx\\.core\\.view\\.${sinif}\\s*;`).test(java));
  }
  kontrol('BridgeActivity içe aktarılmış', /import\s+com\.getcapacitor\.BridgeActivity\s*;/.test(java));
  kontrol('Bundle içe aktarılmış', /import\s+android\.os\.Bundle\s*;/.test(java));
}

// ===== 2b) Java gerçekten DERLENİYOR mu? ================================
// Android SDK ve androidx burada yok (bu ortamda Google sunucuları kapalı),
// o yüzden kullandığımız sınıfların SAHTE (stub) hâllerini üretip javac ile
// derliyoruz. Bu, gerçek kütüphaneyi doğrulamaz ama asıl riski kapatır:
// yazım hatası, eksik parantez, yanlış imza, eksik import. Bunlar yüzünden
// GitHub'da derleme patlarsa hata ancak 5 dakika ve bir tur sonra görülüyor.
console.log('2b) Java derleniyor mu');
{
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'javastub-'));
  const yaz = (yol, icerik) => {
    const tam = path.join(stub, yol);
    fs.mkdirSync(path.dirname(tam), { recursive: true });
    fs.writeFileSync(tam, icerik, 'utf-8');
  };
  yaz('android/os/Bundle.java', 'package android.os; public class Bundle {}');
  yaz('android/view/View.java', 'package android.view; public class View {}');
  yaz('android/view/Window.java',
    'package android.view; public class Window { public View getDecorView() { return null; } }');
  yaz('android/app/Activity.java',
    'package android.app; import android.os.Bundle; import android.view.Window;'
    + ' public class Activity { public void onCreate(Bundle b) {}'
    + ' public void onWindowFocusChanged(boolean f) {}'
    + ' public Window getWindow() { return null; } }');
  yaz('com/getcapacitor/BridgeActivity.java',
    'package com.getcapacitor; public class BridgeActivity extends android.app.Activity {}');
  yaz('androidx/core/view/WindowInsetsCompat.java',
    'package androidx.core.view; public class WindowInsetsCompat {'
    + ' public static class Type { public static int systemBars() { return 1; } } }');
  yaz('androidx/core/view/WindowInsetsControllerCompat.java',
    'package androidx.core.view; public class WindowInsetsControllerCompat {'
    + ' public static final int BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE = 2;'
    + ' public void setSystemBarsBehavior(int b) {}'
    + ' public void hide(int t) {} }');
  yaz('androidx/core/view/WindowCompat.java',
    'package androidx.core.view; import android.view.Window; import android.view.View;'
    + ' public class WindowCompat { public static WindowInsetsControllerCompat'
    + ' getInsetsController(Window w, View v) { return null; } }');
  fs.copyFileSync(path.join(ROOT, 'android-config/MainActivity.java'),
    path.join(stub, 'MainActivity.java'));

  let ciktiKlasoru = path.join(stub, 'out');
  fs.mkdirSync(ciktiKlasoru, { recursive: true });
  let sonuc;
  try {
    const dosyalar = [];
    const gez = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const t = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'out') gez(t); }
        else if (e.name.endsWith('.java')) dosyalar.push(t);
      }
    };
    gez(stub);
    sonuc = spawnSync('javac', ['-nowarn', '-d', ciktiKlasoru, ...dosyalar], { encoding: 'utf-8' });
  } catch (e) {
    sonuc = { error: e };
  }
  if (sonuc.error && sonuc.error.code === 'ENOENT') {
    console.log('  · javac yok, bu adım atlandı');
  } else {
    // JAVA_TOOL_OPTIONS satırı her çağrıda basılıyor, hata değil — eliyoruz.
    const ciktı = `${sonuc.stdout || ''}${sonuc.stderr || ''}`
      .split('\n').filter((l) => l.trim() && !l.startsWith('Picked up ')).join('\n').trim();
    kontrol('MainActivity.java derleniyor', sonuc.status === 0, ciktı ? ciktı.split('\n')[0] : 'hata yok');
    kontrol('MainActivity.class üretildi',
      fs.existsSync(path.join(ciktiKlasoru, ...cfg.appId.split('.'), 'MainActivity.class')));
  }
  fs.rmSync(stub, { recursive: true, force: true });
}

// ===== 3) Derleme akışı doğru yola kopyalıyor mu? ========================
console.log('3) Derleme akışı');
const beklenenYol = `android/app/src/main/java/${cfg.appId.replace(/\./g, '/')}/MainActivity.java`;
kontrol('akış MainActivity kopyalıyor', /cp .*android-config\/MainActivity\.java/.test(akis));
kontrol('kopyalanan yol appId ile uyuşuyor', akis.includes(beklenenYol), beklenenYol);
kontrol('yol yoksa derleme duruyor (test -f)', /test -f "\$HEDEF"/.test(akis));
kontrol('kopyalama APK derlemeden ÖNCE',
  akis.indexOf('MainActivity.java') < akis.indexOf('assembleDebug'));
kontrol('kopyalama proje üretildikten SONRA',
  akis.indexOf('cap sync android') < akis.indexOf('MainActivity.java'));

// ===== 4) Simgeler ve imza ==============================================
console.log('4) Simge ve imza');
kontrol('android-icons.pack.json var', varMi('android-icons.pack.json'));
kontrol('akış simge paketini açıyor', /simge-paketle\.mjs ac/.test(akis));
kontrol('akış simgeleri yerleştiriyor', /cp -rv android-icons\/mipmap-\*/.test(akis));
kontrol('sabit imza anahtarı var', varMi('android-config/debug.keystore'));
kontrol('akış sabit imzayı kullanıyor', /cp android-config\/debug\.keystore/.test(akis));

if (varMi('android-icons.pack.json')) {
  const paket = JSON.parse(oku('android-icons.pack.json'));
  kontrol('simge paketinde 16 dosya var', paket.dosyaSayisi === 16, `${paket.dosyaSayisi}`);
  kontrol('uyarlanabilir simge XML’i pakette',
    Object.keys(paket.dosyalar || {}).some((k) => k.endsWith('ic_launcher_background.xml')));
}

// ===== 5) android/ klasörü depoya sızmamalı =============================
console.log('5) Depo temizliği');
const gitignore = oku('.gitignore');
kontrol('android-icons/ yok sayılıyor', /^android-icons\/$/m.test(gitignore));
kontrol('www/ yok sayılıyor', /^www\/$/m.test(gitignore));
kontrol('dist/ yok sayılıyor', /^dist\/$/m.test(gitignore));

console.log(`\n${sayac} kontrol · ${hatalar.length} hata`);
if (hatalar.length) {
  for (const h of hatalar) console.log('  ✗', h);
  console.log('\nAPK AYAR TESTİ BAŞARISIZ ✗');
  process.exit(1);
}
console.log('\nAPK AYAR TESTİ GEÇTİ ✓');
