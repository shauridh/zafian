package com.sabana.pos;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.ArrayAdapter;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Bridge printer Bluetooth untuk RPP02N.
 *
 * Aplikasi web mengirim payload ESC/POS base64. Bridge ini menyimpan alamat
 * printer yang terakhir dipakai dan mencoba menyambung ulang sebelum setiap
 * struk, sehingga koneksi yang putus saat layar mati tidak perlu dipasangkan
 * ulang secara manual.
 */
public final class PrinterBridge {
    /**
     * Fallback yang dipasang setelah halaman selesai dimuat. Shim di bundle web
     * biasanya sudah lebih dulu ada; blok ini menjaga APK lama tetap berfungsi
     * saat web di-redeploy tanpa shim.
     */
    static final String BRIDGE_SHIM =
            "(function(){"
            + "if(window.SabanaPrinter&&window.__sabanaNativeResolve)return;"
            + "var p={},n=0;"
            + "window.__sabanaNativeResolve=function(id,payload){var e=p[id];if(!e)return;delete p[id];clearTimeout(e.t);try{var v=JSON.parse(payload);if(v&&v.ok===false)e.j(new Error(v.error||'Perintah printer gagal'));else e.r(v)}catch(x){e.j(new Error('Respons printer tidak valid'))}};"
            + "function q(m,a){return new Promise(function(r,j){var id='sabana-'+(++n)+'-'+Date.now();var t=setTimeout(function(){delete p[id];j(new Error('Printer tidak merespons'))},30000);p[id]={r:r,j:j,t:t};try{window.SabanaNative[m].apply(window.SabanaNative,[id].concat(a||[]))}catch(e){delete p[id];clearTimeout(t);j(e)}})}"
            + "window.SabanaPrinter={"
            + "getStatus:function(){try{return JSON.parse(window.SabanaNative.getStatus())}catch(e){return{connected:false,deviceName:null}}},"
            + "pair:function(){return q('requestPair',[])},"
            + "reconnect:function(name){return q('requestReconnect',[name||''])},"
            + "disconnect:function(){return q('requestDisconnect',[])},"
            + "sendReceipt:function(input){return q('requestSendReceipt',[JSON.stringify({payloads:input.payloads,copies:input.copies})])}"
            + "};"
            + "})();";

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final long CONNECT_TIMEOUT_MS = 15_000L;
    private static final Set<String> PRINT_SERVICES = new HashSet<>(Arrays.asList(
            "0000ff00-0000-1000-8000-00805f9b34fb",
            "000018f0-0000-1000-8000-00805f9b34fb",
            "0000ffe0-0000-1000-8000-00805f9b34fb",
            "0000ffe5-0000-1000-8000-00805f9b34fb",
            "0000fff0-0000-1000-8000-00805f9b34fb",
            "0000ae30-0000-1000-8000-00805f9b34fb",
            "49535343-fe7d-4ae5-8fa9-9fafd205e455",
            "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
            "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
    ));

    private final Activity activity;
    private final WebView webView;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final BluetoothAdapter adapter;
    private final Object lock = new Object();

    private volatile Link connection;
    private String savedAddress;
    private String savedName;
    private String savedTransport;

    private AlertDialog pickerDialog;
    private ArrayAdapter<String> pickerAdapter;
    private final List<BluetoothDevice> pickerDevices = new ArrayList<>();
    private final Set<String> pickerAddresses = new HashSet<>();
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private boolean pickerResolved;
    private String pickerRequestId;
    private final Runnable stopScanTask = this::stopScan;

    public PrinterBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.prefs = activity.getSharedPreferences("sabana_printer", Context.MODE_PRIVATE);
        BluetoothManager manager = (BluetoothManager) activity.getSystemService(Context.BLUETOOTH_SERVICE);
        this.adapter = manager == null ? null : manager.getAdapter();
        this.savedAddress = prefs.getString("address", null);
        this.savedName = prefs.getString("name", null);
        this.savedTransport = prefs.getString("transport", "classic");
    }

    @JavascriptInterface
    public String getStatus() {
        JSONObject out = new JSONObject();
        try {
            Link current = connection;
            boolean connected = current != null && current.isConnected();
            out.put("connected", connected);
            out.put("deviceName", connected ? current.deviceName() : (savedName == null ? JSONObject.NULL : savedName));
            out.put("transport", connected ? current.transport() : (savedTransport == null ? JSONObject.NULL : savedTransport));
        } catch (Exception ignored) {
            // Status minimal tetap dikirim ke JavaScript.
        }
        return out.toString();
    }

    @JavascriptInterface
    public void requestPair(String requestId) {
        main.post(() -> {
            if (adapter == null) {
                reject(requestId, "Perangkat ini tidak memiliki Bluetooth");
                return;
            }
            if (!hasBluetoothPermissions()) {
                requestBluetoothPermissions();
                reject(requestId, "Izinkan akses Bluetooth lalu tekan Cari & pasangkan lagi");
                return;
            }
            if (!adapter.isEnabled()) {
                try {
                    activity.startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE));
                } catch (Exception ignored) {
                    // Pesan di bawah tetap memberi langkah yang bisa dilakukan.
                }
                reject(requestId, "Nyalakan Bluetooth lalu tekan Cari & pasangkan lagi");
                return;
            }
            if (pickerDialog != null && pickerDialog.isShowing()) {
                reject(requestId, "Pemilihan printer sedang berjalan");
                return;
            }
            showPicker(requestId);
        });
    }

    @JavascriptInterface
    public void requestReconnect(String requestId, String preferredName) {
        new Thread(() -> {
            try {
                ensureAdapterReady();
                BluetoothDevice device = resolveDevice(preferredName == null ? "" : preferredName.trim());
                Link link = connectTo(device, savedTransport);
                synchronized (lock) {
                    closeConnectionLocked();
                    connection = link;
                    remember(device, link);
                }
                persist();
                JSONObject data = statusJson();
                data.put("deviceName", savedName);
                data.put("transport", savedTransport);
                resolve(requestId, data);
            } catch (Exception error) {
                reject(requestId, friendly(error));
            }
        }, "sabana-reconnect").start();
    }

    @JavascriptInterface
    public void requestDisconnect(String requestId) {
        new Thread(() -> {
            synchronized (lock) {
                closeConnectionLocked();
            }
            try {
                resolve(requestId, statusJson());
            } catch (Exception error) {
                reject(requestId, "Printer diputuskan");
            }
        }, "sabana-disconnect").start();
    }

    @JavascriptInterface
    public void requestSendReceipt(String requestId, String inputJson) {
        new Thread(() -> {
            try {
                JSONObject input = new JSONObject(inputJson);
                JSONArray payloads = input.getJSONArray("payloads");
                List<byte[]> bytes = new ArrayList<>();
                for (int index = 0; index < payloads.length(); index += 1) {
                    bytes.add(android.util.Base64.decode(payloads.getString(index), android.util.Base64.NO_WRAP));
                }
                if (bytes.isEmpty()) throw new IOException("Struk kosong");
                sendAll(bytes);
                JSONObject data = statusJson();
                data.put("deviceName", savedName);
                data.put("transport", savedTransport);
                resolve(requestId, data);
            } catch (Exception error) {
                closeConnection();
                reject(requestId, friendly(error));
            }
        }, "sabana-print").start();
    }

    private void ensureAdapterReady() throws IOException {
        if (adapter == null) throw new IOException("Perangkat ini tidak memiliki Bluetooth");
        if (!hasBluetoothPermissions()) {
            requestBluetoothPermissions();
            throw new IOException("Izinkan akses Bluetooth lalu coba lagi");
        }
        if (!adapter.isEnabled()) throw new IOException("Bluetooth mati. Nyalakan Bluetooth lalu coba lagi");
    }

    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT < 31) return true;
        return activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
                && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= 31) {
            activity.requestPermissions(new String[]{
                    Manifest.permission.BLUETOOTH_CONNECT,
                    Manifest.permission.BLUETOOTH_SCAN
            }, 2002);
        }
    }

    private void showPicker(String requestId) {
        stopScan();
        pickerResolved = false;
        pickerRequestId = requestId;
        pickerDevices.clear();
        pickerAddresses.clear();
        pickerAdapter = new ArrayAdapter<>(activity, android.R.layout.simple_list_item_1, new ArrayList<String>());

        if (hasBluetoothPermissions()) {
            for (BluetoothDevice device : adapter.getBondedDevices()) addPickerDevice(device);
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setTitle("Pilih printer RPP02N")
                .setMessage("Pilih perangkat yang sudah dipasangkan, atau pindai printer BLE di sekitar.")
                .setAdapter(pickerAdapter, (dialog, which) -> {
                    if (which < 0 || which >= pickerDevices.size()) return;
                    BluetoothDevice device = pickerDevices.get(which);
                    pickerResolved = true;
                    dialog.dismiss();
                    connectPicked(requestId, device);
                })
                .setNegativeButton("Batal", (dialog, which) -> {
                    pickerResolved = true;
                    stopScan();
                    reject(requestId, "Pencarian printer dibatalkan");
                })
                .setNeutralButton("Pindai BLE", null);

        AlertDialog dialog = builder.create();
        pickerDialog = dialog;
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> startScan()));
        dialog.setOnDismissListener(ignored -> {
            stopScan();
            if (!pickerResolved && requestId.equals(pickerRequestId)) reject(requestId, "Pemilihan printer ditutup");
            pickerDialog = null;
            pickerRequestId = null;
        });
        dialog.show();
    }

    private void addPickerDevice(BluetoothDevice device) {
        if (device == null) return;
        String address = device.getAddress();
        if (address == null || pickerAddresses.contains(address)) return;
        pickerAddresses.add(address);
        pickerDevices.add(device);
        String name = device.getName();
        if (name == null || name.trim().isEmpty()) name = address;
        String type = device.getType() == BluetoothDevice.DEVICE_TYPE_LE
                ? "BLE"
                : device.getType() == BluetoothDevice.DEVICE_TYPE_CLASSIC ? "Classic" : "Dual";
        if (pickerAdapter != null) pickerAdapter.add(name + " (" + type + ")");
    }

    private void startScan() {
        if (scanner != null || adapter == null) return;
        if (Build.VERSION.SDK_INT >= 31
                && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            requestBluetoothPermissions();
            Toast.makeText(activity, "Izinkan izin Nearby devices untuk memindai BLE", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            scanner = adapter.getBluetoothLeScanner();
            if (scanner == null) {
                Toast.makeText(activity, "Pemindai BLE tidak tersedia di perangkat ini", Toast.LENGTH_LONG).show();
                return;
            }
            scanCallback = new ScanCallback() {
                @Override
                public void onScanResult(int callbackType, ScanResult result) {
                    if (result == null || result.getDevice() == null) return;
                    main.post(() -> {
                        if (pickerDialog != null && pickerDialog.isShowing()) addPickerDevice(result.getDevice());
                    });
                }

                @Override
                public void onScanFailed(int errorCode) {
                    main.post(() -> Toast.makeText(activity, "Pemindaian BLE gagal (" + errorCode + ")", Toast.LENGTH_LONG).show());
                }
            };
            scanner.startScan(scanCallback);
            main.postDelayed(stopScanTask, 10_000L);
            Toast.makeText(activity, "Memindai printer BLE…", Toast.LENGTH_SHORT).show();
        } catch (SecurityException error) {
            requestBluetoothPermissions();
            Toast.makeText(activity, "Izin Bluetooth diperlukan untuk memindai", Toast.LENGTH_LONG).show();
        }
    }

    private void stopScan() {
        main.removeCallbacks(stopScanTask);
        if (scanner != null && scanCallback != null) {
            try {
                scanner.stopScan(scanCallback);
            } catch (Exception ignored) {
                // Pemindai mungkin sudah berhenti.
            }
        }
        scanner = null;
        scanCallback = null;
    }

    private void connectPicked(String requestId, BluetoothDevice device) {
        new Thread(() -> {
            Link link = null;
            try {
                link = connectTo(device, null);
                synchronized (lock) {
                    closeConnectionLocked();
                    connection = link;
                    remember(device, link);
                }
                persist();
                JSONObject data = statusJson();
                data.put("deviceName", savedName);
                data.put("transport", savedTransport);
                resolve(requestId, data);
            } catch (Exception error) {
                if (link != null) link.close();
                reject(requestId, friendly(error));
            }
        }, "sabana-pair").start();
    }

    private Link connectTo(BluetoothDevice device, String preferredTransport) throws Exception {
        if (adapter == null) throw new IOException("Perangkat ini tidak memiliki Bluetooth");
        String first = preferredTransport;
        if (first == null || first.trim().isEmpty()) {
            first = device.getType() == BluetoothDevice.DEVICE_TYPE_LE ? "ble" : "classic";
        }
        List<String> attempts = new ArrayList<>();
        attempts.add(first);
        if (!attempts.contains("ble") && device.getType() != BluetoothDevice.DEVICE_TYPE_CLASSIC) attempts.add("ble");
        if (!attempts.contains("classic") && device.getType() != BluetoothDevice.DEVICE_TYPE_LE) attempts.add("classic");

        Exception last = null;
        for (String transport : attempts) {
            Link link = "ble".equals(transport) ? new BleLink(device) : new ClassicLink(device);
            try {
                if ("classic".equals(transport)) ensureBonded(device);
                link.connect();
                if (link.isConnected()) return link;
                throw new IOException("Printer tidak terhubung");
            } catch (Exception error) {
                last = error;
                link.close();
            }
        }
        String message = last == null || last.getMessage() == null ? "Gagal menghubungkan printer" : last.getMessage();
        throw new IOException(message, last);
    }

    private void ensureBonded(BluetoothDevice device) throws IOException {
        if (device.getBondState() == BluetoothDevice.BOND_BONDED) return;
        boolean started = device.createBond();
        long deadline = System.currentTimeMillis() + 20_000L;
        while (System.currentTimeMillis() < deadline && device.getBondState() != BluetoothDevice.BOND_BONDED) {
            try {
                Thread.sleep(250L);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new IOException("Pairing Bluetooth dibatalkan");
            }
        }
        if (device.getBondState() != BluetoothDevice.BOND_BONDED) {
            throw new IOException(started
                    ? "Pairing RPP02N belum selesai. Setujui dialog Bluetooth Android lalu coba lagi."
                    : "Pasangkan RPP02N lewat Pengaturan Bluetooth Android, lalu coba lagi.");
        }
    }

    private BluetoothDevice resolveDevice(String preferredName) throws IOException {
        if (adapter == null) throw new IOException("Perangkat ini tidak memiliki Bluetooth");
        if (savedAddress != null && !savedAddress.trim().isEmpty()) {
            try {
                return adapter.getRemoteDevice(savedAddress);
            } catch (IllegalArgumentException ignored) {
                // Alamat tersimpan rusak; coba cari berdasarkan nama.
            }
        }
        if (!preferredName.isEmpty()) {
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                String name = device.getName();
                if (name != null && name.equalsIgnoreCase(preferredName)) return device;
            }
        }
        throw new IOException("Belum ada printer tersimpan. Buka Pengaturan → Printer & struk → Cari & pasangkan.");
    }

    private void remember(BluetoothDevice device, Link link) {
        String name = device.getName();
        savedAddress = device.getAddress();
        savedName = name == null || name.trim().isEmpty() ? link.deviceName() : name.trim();
        savedTransport = link.transport();
    }

    private void persist() {
        prefs.edit()
                .putString("address", savedAddress)
                .putString("name", savedName)
                .putString("transport", savedTransport)
                .apply();
    }

    private void sendAll(List<byte[]> payloads) throws Exception {
        synchronized (lock) {
            ensureConnectedLocked();
            boolean sentAny = false;
            try {
                for (byte[] payload : payloads) {
                    connection.send(payload);
                    sentAny = true;
                }
            } catch (Exception error) {
                // Hanya ulangi bila belum ada satu struk pun yang terkirim,
                // supaya kegagalan di tengah salinan tidak mencetak ganda.
                if (sentAny) throw error;
                closeConnectionLocked();
                ensureConnectedLocked();
                for (byte[] payload : payloads) connection.send(payload);
            }
        }
    }

    private void ensureConnectedLocked() throws Exception {
        if (connection != null && connection.isConnected()) return;
        closeConnectionLocked();
        if (adapter == null) throw new IOException("Perangkat ini tidak memiliki Bluetooth");
        if (savedAddress == null || savedAddress.trim().isEmpty()) {
            throw new IOException("Belum ada printer tersimpan. Pasangkan RPP02N di Pengaturan.");
        }
        BluetoothDevice device = adapter.getRemoteDevice(savedAddress);
        connection = connectTo(device, savedTransport);
    }

    private void closeConnection() {
        synchronized (lock) {
            closeConnectionLocked();
        }
    }

    private void closeConnectionLocked() {
        if (connection != null) {
            connection.close();
            connection = null;
        }
    }

    private JSONObject statusJson() throws Exception {
        JSONObject out = new JSONObject();
        Link current = connection;
        boolean connected = current != null && current.isConnected();
        out.put("connected", connected);
        out.put("deviceName", connected ? current.deviceName() : (savedName == null ? JSONObject.NULL : savedName));
        out.put("transport", connected ? current.transport() : (savedTransport == null ? JSONObject.NULL : savedTransport));
        return out;
    }

    private void resolve(String requestId, JSONObject data) {
        try {
            data.put("ok", true);
        } catch (Exception ignored) {
            // Data status tetap bisa dikirim tanpa flag ok.
        }
        post(requestId, data);
    }

    private void reject(String requestId, String message) {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", false);
            out.put("error", message == null ? "Perintah printer gagal" : message);
        } catch (Exception ignored) {
            // Tidak ada yang bisa dilakukan bila JSON gagal dibuat.
        }
        post(requestId, out);
    }

    private void post(String requestId, JSONObject data) {
        if (requestId == null || requestId.isEmpty()) return;
        final String script = "window.__sabanaNativeResolve("
                + JSONObject.quote(requestId) + ","
                + JSONObject.quote(data.toString()) + ");";
        main.post(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private String friendly(Exception error) {
        if (error instanceof SecurityException) {
            return "Izin Bluetooth ditolak. Buka Pengaturan Android → Aplikasi → Sabana POS → Izin, lalu izinkan Bluetooth.";
        }
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) message = "Gagal menghubungi printer";
        if (message.contains("read failed") || message.contains("socket") || message.contains("Broken pipe")) {
            return "Printer menolak koneksi. Pastikan RPP02N menyala dan sudah dipasangkan di Bluetooth Android.";
        }
        return message;
    }

    public void destroy() {
        stopScan();
        closeConnection();
    }

    private interface Link {
        String deviceName();
        String transport();
        boolean isConnected();
        void connect() throws Exception;
        void send(byte[] payload) throws Exception;
        void close();
    }

    private final class ClassicLink implements Link {
        private final BluetoothDevice device;
        private BluetoothSocket socket;
        private OutputStream output;

        ClassicLink(BluetoothDevice device) {
            this.device = device;
        }

        @Override
        public String deviceName() {
            String name = device.getName();
            return name == null || name.trim().isEmpty() ? device.getAddress() : name;
        }

        @Override
        public String transport() {
            return "classic";
        }

        @Override
        public boolean isConnected() {
            return socket != null && socket.isConnected() && output != null;
        }

        @Override
        public void connect() throws Exception {
            if (isConnected()) return;
            if (adapter != null) adapter.cancelDiscovery();
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            try {
                socket.connect();
            } catch (Exception first) {
                close();
                socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
            }
            output = socket.getOutputStream();
        }

        @Override
        public void send(byte[] payload) throws Exception {
            if (!isConnected()) throw new IOException("Printer Classic belum terhubung");
            for (int offset = 0; offset < payload.length; offset += 128) {
                int length = Math.min(128, payload.length - offset);
                output.write(payload, offset, length);
                output.flush();
                Thread.sleep(15L);
            }
        }

        @Override
        public void close() {
            try {
                if (output != null) output.close();
            } catch (IOException ignored) {
                // Socket mungkin sudah ditutup.
            }
            try {
                if (socket != null) socket.close();
            } catch (IOException ignored) {
                // Socket mungkin sudah ditutup.
            }
            output = null;
            socket = null;
        }
    }

    private final class BleLink implements Link {
        private final BluetoothDevice device;
        private BluetoothGatt gatt;
        private BluetoothGattCharacteristic writeCharacteristic;
        private volatile boolean ready;
        private int writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;

        BleLink(BluetoothDevice device) {
            this.device = device;
        }

        @Override
        public String deviceName() {
            String name = device.getName();
            return name == null || name.trim().isEmpty() ? device.getAddress() : name;
        }

        @Override
        public String transport() {
            return "ble";
        }

        @Override
        public boolean isConnected() {
            return ready && gatt != null;
        }

        @Override
        public void connect() throws Exception {
            if (isConnected()) return;
            ready = false;
            final CountDownLatch latch = new CountDownLatch(1);
            final AtomicReference<String> failure = new AtomicReference<>();
            gatt = device.connectGatt(activity, false, new BluetoothGattCallback() {
                @Override
                public void onConnectionStateChange(BluetoothGatt callbackGatt, int status, int newState) {
                    if (newState == BluetoothProfile.STATE_CONNECTED) {
                        callbackGatt.discoverServices();
                    } else {
                        failure.set("Koneksi BLE terputus (status " + status + ")");
                        latch.countDown();
                        try {
                            callbackGatt.close();
                        } catch (Exception ignored) {
                            // GATT mungkin sudah ditutup.
                        }
                    }
                }

                @Override
                public void onServicesDiscovered(BluetoothGatt callbackGatt, int status) {
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        failure.set("Gagal membaca layanan printer BLE");
                        latch.countDown();
                        return;
                    }
                    writeCharacteristic = findWritable(callbackGatt);
                    if (writeCharacteristic == null) {
                        failure.set("Printer BLE tidak punya karakteristik tulis");
                        latch.countDown();
                        return;
                    }
                    int properties = writeCharacteristic.getProperties();
                    writeType = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
                            ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                            : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
                    ready = true;
                    latch.countDown();
                }
            }, BluetoothDevice.TRANSPORT_LE);
            if (gatt == null) throw new IOException("Gagal membuka koneksi BLE");
            if (!latch.await(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                close();
                throw new IOException("Printer BLE tidak merespons. Nyalakan printer lalu coba lagi.");
            }
            if (failure.get() != null) {
                close();
                throw new IOException(failure.get());
            }
            if (!ready) {
                close();
                throw new IOException("Printer BLE belum siap");
            }
        }

        private BluetoothGattCharacteristic findWritable(BluetoothGatt callbackGatt) {
            for (int pass = 0; pass < 2; pass += 1) {
                for (BluetoothGattService service : callbackGatt.getServices()) {
                    boolean known = PRINT_SERVICES.contains(service.getUuid().toString().toLowerCase());
                    if (pass == 0 && !known) continue;
                    if (pass == 1 && known) continue;
                    for (BluetoothGattCharacteristic characteristic : service.getCharacteristics()) {
                        int properties = characteristic.getProperties();
                        if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
                                || (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
                            return characteristic;
                        }
                    }
                }
            }
            return null;
        }

        @Override
        public void send(byte[] payload) throws Exception {
            if (!isConnected() || gatt == null || writeCharacteristic == null) {
                throw new IOException("Printer BLE belum terhubung");
            }
            for (int offset = 0; offset < payload.length; offset += 20) {
                int length = Math.min(20, payload.length - offset);
                byte[] chunk = new byte[length];
                System.arraycopy(payload, offset, chunk, 0, length);
                boolean accepted;
                if (Build.VERSION.SDK_INT >= 33) {
                    accepted = gatt.writeCharacteristic(writeCharacteristic, chunk, writeType) == BluetoothStatusCodes.SUCCESS;
                } else {
                    writeCharacteristic.setWriteType(writeType);
                    writeCharacteristic.setValue(chunk);
                    accepted = gatt.writeCharacteristic(writeCharacteristic);
                }
                if (!accepted) throw new IOException("Gagal mengirim data ke printer BLE");
                Thread.sleep(25L);
            }
        }

        @Override
        public void close() {
            ready = false;
            writeCharacteristic = null;
            if (gatt != null) {
                try {
                    gatt.disconnect();
                } catch (Exception ignored) {
                    // GATT mungkin sudah terputus.
                }
                try {
                    gatt.close();
                } catch (Exception ignored) {
                    // GATT mungkin sudah ditutup.
                }
                gatt = null;
            }
        }
    }
}
