"use client";

import { useState, useEffect } from "react";
import { notifications } from "@/lib/notifications";

export default function NotificationSettings() {
  const [permissionStatus, setPermissionStatus] = useState({
    supported: false,
    permission: "default" as NotificationPermission,
    canNotify: false,
  });
  const [monitoring, setMonitoring] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    setPermissionStatus(notifications.getPermissionStatus());
  }, []);

  const handleRequestPermission = async () => {
    const granted = await notifications.requestPermission();
    setPermissionStatus(notifications.getPermissionStatus());
    
    if (granted) {
      // Send test notification
      await notifications.sendNotification({
        title: "✅ Notifikasi Aktif",
        body: "Anda akan menerima notifikasi untuk stok menipis dan pesanan baru",
      });
    }
  };

  const handleStartMonitoring = () => {
    if (monitoring) {
      // Already monitoring
      return;
    }
    
    // Start monitoring (every 5 minutes)
    const cleanup = notifications.startStockMonitoring(5 * 60 * 1000);
    setMonitoring(true);
    setLastCheck(new Date());
    
    // Check immediately
    notifications.checkStockAlerts().then((stockAlerts) => {
      setAlerts(stockAlerts);
    });
  };

  const handleCheckNow = async () => {
    const stockAlerts = await notifications.checkStockAlerts();
    setAlerts(stockAlerts);
    setLastCheck(new Date());
    
    if (stockAlerts.length === 0) {
      await notifications.sendNotification({
        title: "✅ Stok Aman",
        body: "Semua produk memiliki stok yang cukup",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Permission Status */}
      <div className="bg-white rounded-xl p-5 border border-gray-100">
        <h3 className="font-bold text-gray-800 mb-4">Izin Notifikasi</h3>
        
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-medium text-gray-800">Browser Push Notification</p>
            <p className="text-sm text-gray-500">
              {permissionStatus.supported 
                ? `Status: ${permissionStatus.permission === "granted" ? "✅ Diizinkan" : permissionStatus.permission === "denied" ? "❌ Diblokir" : "⏳ Belum ditentukan"}`
                : "❌ Tidak didukung di browser ini"
              }
            </p>
          </div>
          
          {!permissionStatus.canNotify && permissionStatus.supported && (
            <button
              onClick={handleRequestPermission}
              className="px-4 py-2 bg-sabana text-white rounded-lg font-medium hover:bg-sabana-dark transition-colors"
            >
              Izinkan Notifikasi
            </button>
          )}
        </div>

        {!permissionStatus.supported && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-yellow-700 text-sm">
              ⚠️ Browser Anda tidak mendukung push notification. Gunakan Chrome atau Firefox untuk fitur ini.
            </p>
          </div>
        )}
      </div>

      {/* Stock Monitoring */}
      <div className="bg-white rounded-xl p-5 border border-gray-100">
        <h3 className="font-bold text-gray-800 mb-4">Monitoring Stok</h3>
        
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-medium text-gray-800">Auto-Check Stok</p>
            <p className="text-sm text-gray-500">
              {monitoring 
                ? `🟢 Aktif (setiap 5 menit)`
                : "🔴 Nonaktif"
              }
              {lastCheck && ` • Terakhir: ${lastCheck.toLocaleTimeString("id-ID")}`}
            </p>
          </div>
          
          <button
            onClick={handleStartMonitoring}
            disabled={monitoring}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              monitoring 
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-green-500 text-white hover:bg-green-600"
            }`}
          >
            {monitoring ? "Sudah Aktif" : "Mulai Monitoring"}
          </button>
        </div>

        <button
          onClick={handleCheckNow}
          className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
        >
          🔍 Cek Sekarang
        </button>
      </div>

      {/* Active Alerts */}
      <div className="bg-white rounded-xl p-5 border border-gray-100">
        <h3 className="font-bold text-gray-800 mb-4">Alert Aktif ({alerts.length})</h3>
        
        {alerts.length === 0 ? (
          <div className="text-center py-6">
            <span className="text-3xl mb-2 block">✅</span>
            <p className="text-gray-500">Semua stok aman</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert, index) => (
              <div 
                key={index}
                className={`flex items-center gap-3 p-3 rounded-lg ${
                  alert.severity === "critical" 
                    ? "bg-red-50 border border-red-200" 
                    : "bg-yellow-50 border border-yellow-200"
                }`}
              >
                <span className="text-2xl">
                  {alert.severity === "critical" ? "🚨" : "⚠️"}
                </span>
                <div className="flex-1">
                  <p className={`font-medium ${
                    alert.severity === "critical" ? "text-red-800" : "text-yellow-800"
                  }`}>
                    {alert.product_name}
                  </p>
                  <p className={`text-sm ${
                    alert.severity === "critical" ? "text-red-600" : "text-yellow-600"
                  }`}>
                    Stok: {alert.current_stock} / Min: {alert.min_stock}
                  </p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                  alert.severity === "critical" 
                    ? "bg-red-500 text-white" 
                    : "bg-yellow-500 text-white"
                }`}>
                  {alert.severity === "critical" ? "KRITIS" : "MENIPIS"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notification Types */}
      <div className="bg-white rounded-xl p-5 border border-gray-100">
        <h3 className="font-bold text-gray-800 mb-4">Jenis Notifikasi</h3>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl">🚨</span>
              <div>
                <p className="font-medium text-gray-800">Stok Habis</p>
                <p className="text-xs text-gray-500">Ketika produk mencapai 0</p>
              </div>
            </div>
            <span className="text-green-500 font-medium">Aktif</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="font-medium text-gray-800">Stok Menipis</p>
                <p className="text-xs text-gray-500">Ketika stok di bawah minimum</p>
              </div>
            </div>
            <span className="text-green-500 font-medium">Aktif</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl">🛒</span>
              <div>
                <p className="font-medium text-gray-800">Pesanan Baru</p>
                <p className="text-xs text-gray-500">Ketika ada pesanan masuk</p>
              </div>
            </div>
            <span className="text-green-500 font-medium">Aktif</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl">💰</span>
              <div>
                <p className="font-medium text-gray-800">Pembayaran Diterima</p>
                <p className="text-xs text-gray-500">Konfirmasi pembayaran</p>
              </div>
            </div>
            <span className="text-green-500 font-medium">Aktif</span>
          </div>
        </div>
      </div>
    </div>
  );
}
