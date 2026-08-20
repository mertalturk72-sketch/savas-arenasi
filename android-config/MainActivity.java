package com.nuri.savasarenasi;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Oyun ekranını GERÇEKTEN tam ekran yapar.
 *
 * SORUN: telefonu yan çevirince Android'in gezinme çubuğu (geri oku, kare,
 * üç çizgi) ekranın kenarında duruyor ve oyunun üstünü kapatıyordu. Tarayıcının
 * kendi tam ekran isteği (requestFullscreen) uygulama içindeki WebView'da bu
 * çubukları kaldırmaya yetmiyor — onlar WebView'ın değil, PENCERENİN parçası.
 *
 * ÇÖZÜM: pencerenin sistem çubuklarını gizliyoruz ("immersive"). Kullanıcı
 * kenardan parmağını kaydırınca çubuklar geçici olarak geri geliyor
 * (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE), birkaç saniye sonra kendiliğinden
 * yeniden kayboluyor. Yani geri tuşuna ulaşmak hâlâ mümkün, sadece sürekli
 * ekranda durmuyor.
 *
 * Odak her geri geldiğinde tekrar uyguluyoruz: bildirim panelini açıp kapatmak
 * ya da başka uygulamadan dönmek çubukları geri getiriyor.
 *
 * NOT: bu dosya depoda duruyor ve APK derlenirken Capacitor'ün ürettiği
 * MainActivity.java'nın ÜZERİNE kopyalanıyor (.github/workflows/android.yml).
 * Paket adı capacitor.config.json içindeki appId ile birebir aynı olmalı;
 * test/apk-ayar.mjs bunu sınıyor.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        cubuklariGizle();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            cubuklariGizle();
        }
    }

    private void cubuklariGizle() {
        WindowInsetsControllerCompat kontrol =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (kontrol == null) {
            return;
        }
        kontrol.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        kontrol.hide(WindowInsetsCompat.Type.systemBars());
    }
}
