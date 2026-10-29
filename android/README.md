# Sabana POS Android shell

Shell Android ini membungkus aplikasi web production di WebView dan menambahkan
bridge printer Bluetooth native. Tujuannya bukan mengganti aplikasi web, tetapi
menghilangkan ketergantungan pada Web Bluetooth yang hanya tersedia di Chrome dan
sering terputus saat layar mati.

> APK memuat halaman dari URL production. Setelah perubahan web (termasuk shim
auto-connect), **deploy ulang Vercel lebih dulu**, lalu pasang APK. Tanpa itu,
APK masih memuat bundle web lama.

## Yang ditangani native

- **Bluetooth Classic/SPP** (jalur umum printer RPP02N) dan **BLE**.
- Menyimpan alamat printer terakhir di `SharedPreferences`.
- **Auto-connect sebelum setiap struk**; jika koneksi putus, bridge mencoba
  menyambung ulang ke printer tersimpan tanpa meminta pairing ulang.
- Layar tetap menyala selama aplikasi di depan (`FLAG_KEEP_SCREEN_ON`) agar
  koneksi printer tidak idle saat kasir sedang melayani.
- Upload foto menu lewat file chooser Android.
- Tautan ke domain lain dibuka di browser, bukan di dalam WebView.

Struk tetap disusun oleh `src/lib/escpos.ts` di web. Bridge hanya menerima
payload ESC/POS base64 dan menulis byte ke printer.

## Build APK debug

Prasyarat: JDK 17 dan Android SDK dengan `platforms;android-34` serta
`build-tools;34.0.0`. Android Studio dapat membuka folder `android/` langsung.

```sh
cd android
./gradlew assembleDebug
```

Hasil:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

APK debug ditandatangani dengan debug keystore lokal dan **tidak bisa** menimpa
APK release (tanda tangan berbeda). Gunakan APK debug hanya untuk uji cepat.

## Build APK release (tanda tangan tetap)

APK release memakai keystore sendiri supaya update berikutnya bisa dipasang
tanpa uninstall, asalkan `versionCode` dinaikkan dan keystore yang sama dipakai.

Prasyarat:

- `android/release.keystore` — file keystore release.
- `android/keystore.properties` — kredensial keystore (gitignored).

Salin contoh lalu isi:

```sh
cp android/keystore.properties.example android/keystore.properties
```

```properties
storeFile=release.keystore
storePassword=...
keyAlias=sabana
keyPassword=...
```

Build:

```sh
cd android
./gradlew assembleRelease
```

Hasil:

```
android/app/build/outputs/apk/release/app-release.apk
```

**Penting:**

- `release.keystore` dan `keystore.properties` tidak boleh di-commit. Simpan
  backup keduanya; kalau hilang, update berikutnya harus uninstall dulu karena
  tidak bisa ditandatangani dengan kunci yang sama.
- Naikkan `versionCode` di `android/app/build.gradle` setiap kali merilis update.
- APK debug dan release memakai kunci berbeda, jadi memasang release di atas
  debug akan ditolak Android. Uninstall APK debug sekali, lalu pasang release.
- `assembleRelease` akan gagal dengan pesan jelas bila `keystore.properties`
  tidak ada, supaya tidak ada APK "release" yang diam-diam ditandatangani debug.

## Mengubah URL aplikasi

Edit `android/app/src/main/res/values/strings.xml`:

```xml
<string name="app_url">https://zafian.vercel.app</string>
```

Gunakan domain HTTPS yang menjalankan build web Sabana POS. WebView menolak
cleartext HTTP.

## Cara pakai printer

1. Nyalakan RPP02N.
2. Untuk Bluetooth Classic, pasangkan dulu lewat **Pengaturan Bluetooth
   Android** (PIN default printer biasanya `0000` atau `1234`).
3. Buka **Mode pemilik → Pengaturan → Printer & struk**.
4. Tekan **Cari & pasangkan**; pilih `RPP02N` dari daftar perangkat terpasang,
   atau **Pindai BLE** bila printer tidak muncul di daftar Classic.
5. Setelah status **TERHUBUNG**, tekan **Tes cetak struk**, lalu **Simpan
   pengaturan**.
6. Cetak berikutnya—termasuk auto-print setelah pembayaran—akan memakai printer
   yang sama dan menyambung ulang otomatis bila koneksi sempat putus.

## Batas yang belum diuji

- Build APK di sandbox hanya membuktikan kompilasi dan penandatanganan; belum
  ada uji dengan perangkat Android/RPP02N fisik.
- Unduhan backup berbasis `blob:` dari WebView belum memiliki penanganan native.
  Gunakan browser untuk mengunduh backup sampai handler unduhan ditambahkan.
- WebView memerlukan koneksi ke origin production; data tetap berasal dari
  Supabase seperti aplikasi web.
