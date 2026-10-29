package com.sabana.pos;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Shell Android minimal untuk Sabana POS.
 *
 * Halaman tetap berasal dari build web production supaya rilis web dan APK
 * memakai kode yang sama. Satu-satunya tambahan native adalah bridge printer
 * Bluetooth yang membuat koneksi tidak bergantung pada Web Bluetooth.
 */
public final class MainActivity extends Activity {
    private static final int REQUEST_BLUETOOTH = 2001;
    private static final int REQUEST_FILE = 2002;

    private WebView webView;
    private PrinterBridge printerBridge;
    private ValueCallback<Uri[]> fileCallback;
    private String trustedHost;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        trustedHost = Uri.parse(getString(R.string.app_url)).getHost();
        webView = new WebView(this);
        webView.setBackgroundColor(0xFFF7F1EC);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " SabanaPOSAndroid/1.0");

        printerBridge = new PrinterBridge(this, webView);
        webView.addJavascriptInterface(printerBridge, "SabanaNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternallyIfNeeded(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Fallback bila bundle web belum memuat native-printer-shim.
                view.evaluateJavascript(PrinterBridge.BRIDGE_SHIM, null);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                Uri origin = request.getOrigin();
                String host = origin == null ? null : origin.getHost();
                if (trustedHost != null && trustedHost.equalsIgnoreCase(host)) request.grant(request.getResources());
                else request.deny();
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQUEST_FILE);
                    return true;
                } catch (Exception error) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "Tidak bisa membuka pemilih file", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });

        requestBluetoothPermissions();
        webView.loadUrl(getString(R.string.app_url));
    }

    private boolean openExternallyIfNeeded(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return false;
        String host = uri.getHost();
        if (trustedHost != null && trustedHost.equalsIgnoreCase(host)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // Tidak ada aplikasi yang bisa membuka tautan ini.
        }
        return true;
    }

    private void requestBluetoothPermissions() {
        if (Build.VERSION.SDK_INT < 31) return;
        List<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.BLUETOOTH_SCAN);
        }
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), REQUEST_BLUETOOTH);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_BLUETOOTH) return;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Izin Bluetooth diperlukan untuk mencetak struk", Toast.LENGTH_LONG).show();
                break;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (printerBridge != null) printerBridge.destroy();
        if (webView != null) {
            webView.removeJavascriptInterface("SabanaNative");
            webView.destroy();
        }
        super.onDestroy();
    }
}
