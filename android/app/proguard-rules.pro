# Bridge dipanggil dari JavaScript; jangan obfuscate bila release di-minify.
-keepclassmembers class com.sabana.pos.PrinterBridge {
    @android.webkit.JavascriptInterface <methods>;
}
