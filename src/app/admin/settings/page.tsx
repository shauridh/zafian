"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { isBluetoothAvailable } from "@/lib/printer";
import NotificationSettings from "@/components/admin/NotificationSettings";
import ThemeToggle from "@/components/ThemeToggle";
import BackupSettings from "@/components/admin/BackupSettings";

interface OutletSettings {
  id: string;
  name: string;
  address: string;
  phone: string;
}

interface AppSettings {
  printer_name: string;
  printer_width: "58" | "80";
  low_stock_threshold: number;
  auto_sync_interval: number;
  receipt_footer: string;
  currency: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  printer_name: "",
  printer_width: "58",
  low_stock_threshold: 10,
  auto_sync_interval: 30,
  receipt_footer: "Terima kasih! Sampai jumpa! 🍗 Sabana Fried Chicken 🍗",
  currency: "IDR",
};

export default function SettingsPage() {
  const [outlet, setOutlet] = useState<OutletSettings | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<"checking" | "available" | "unavailable">("checking");

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch outlet
        const { data: outletData } = await supabase
          .from("outlets")
          .select("*")
          .eq("id", "00000000-0000-0000-0000-000000000001")
          .single();

        if (outletData) setOutlet(outletData);

        // Check Bluetooth
        setPrinterStatus(isBluetoothAvailable() ? "available" : "unavailable");

        // Load settings from localStorage
        const savedSettings = localStorage.getItem("sabana-app-settings");
        if (savedSettings) {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
        }
      } catch (err) {
        console.error("Error fetching settings:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleSaveOutlet = async () => {
    if (!outlet) return;
    setSaving(true);
    try {
      await supabase.from("outlets").update({
        name: outlet.name,
        address: outlet.address,
        phone: outlet.phone,
      }).eq("id", outlet.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert("Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = () => {
    localStorage.setItem("sabana-app-settings", JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleResetData = async () => {
    if (!confirm("⚠️ Hapus semua data transaksi hari ini? Tindakan ini tidak dapat dibatalkan!")) return;
    if (!confirm("YAKIN? Ini akan menghapus semua order, shift, dan data hari ini.")) return;

    try {
      // Only delete today's data
      const today = new Date().toISOString().split("T")[0];
      await supabase.from("order_items").delete().gte("created_at", today);
      await supabase.from("orders").delete().gte("created_at", today);
      await supabase.from("shifts").delete().gte("opened_at", today);
      alert("Data hari ini sudah dihapus");
    } catch (err) {
      alert("Gagal menghapus data");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900">⚙️ Pengaturan</h1>
        <p className="text-gray-500 text-sm mt-0.5">Konfigurasi outlet, printer, dan aplikasi</p>
      </div>

      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 text-center">
          <p className="text-sm font-semibold text-green-800">✅ Berhasil disimpan!</p>
        </div>
      )}

      {/* Outlet Info */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
        <h3 className="font-heading font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-sabana-100 flex items-center justify-center text-sm">🏪</span>
          Informasi Outlet
        </h3>
        {outlet && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Nama Outlet</label>
              <input type="text" value={outlet.name} onChange={(e) => setOutlet({ ...outlet, name: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Alamat</label>
              <input type="text" value={outlet.address} onChange={(e) => setOutlet({ ...outlet, address: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">No. HP / Telepon</label>
              <input type="tel" value={outlet.phone} onChange={(e) => setOutlet({ ...outlet, phone: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
            <button onClick={handleSaveOutlet} disabled={saving} className="px-6 py-2.5 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors text-sm disabled:opacity-50">
              {saving ? "Menyimpan..." : "Simpan Outlet"}
            </button>
          </div>
        )}
      </div>

      {/* Printer Settings */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
        <h3 className="font-heading font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-sabana-100 flex items-center justify-center text-sm">🖨️</span>
          Printer Thermal
        </h3>
        <div className="space-y-3">
          <div className={`flex items-center gap-2 p-3 rounded-xl ${printerStatus === "available" ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
            <span className="w-3 h-3 rounded-full bg-current" style={{ color: printerStatus === "available" ? "#16a34a" : "#dc2626" }} />
            <span className="text-sm font-medium">
              {printerStatus === "available" ? "Web Bluetooth tersedia" : "Web Bluetooth tidak tersedia (Chrome/Edge only)"}
            </span>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Nama Printer (optional)</label>
            <input type="text" value={settings.printer_name} onChange={(e) => setSettings({ ...settings, printer_name: e.target.value })} placeholder="XP-N160II" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Lebar Kertas</label>
            <div className="flex gap-2">
              {(["58", "80"] as const).map((w) => (
                <button key={w} onClick={() => setSettings({ ...settings, printer_width: w })} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${settings.printer_width === w ? "border-sabana bg-sabana-50 text-sabana" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                  {w}mm
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* App Settings */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
        <h3 className="font-heading font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-sabana-100 flex items-center justify-center text-sm">📱</span>
          Aplikasi
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Batas Stok Menipis</label>
            <input type="number" value={settings.low_stock_threshold} onChange={(e) => setSettings({ ...settings, low_stock_threshold: parseInt(e.target.value) || 10 })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm font-mono" min={1} />
            <p className="text-xs text-gray-400 mt-1">Notifikasi muncul saat stok di bawah angka ini</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Auto-Sync Interval (detik)</label>
            <input type="number" value={settings.auto_sync_interval} onChange={(e) => setSettings({ ...settings, auto_sync_interval: parseInt(e.target.value) || 30 })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm font-mono" min={10} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Footer Struk</label>
            <textarea value={settings.receipt_footer} onChange={(e) => setSettings({ ...settings, receipt_footer: e.target.value })} rows={2} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm resize-none" />
          </div>
          <button onClick={handleSaveSettings} className="px-6 py-2.5 bg-sabana text-white rounded-xl font-semibold hover:bg-sabana-dark transition-colors text-sm">
            Simpan Pengaturan
          </button>
        </div>
      </div>

      {/* Theme Settings */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
        <h3 className="font-heading font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-sabana-100 flex items-center justify-center text-sm">🎨</span>
          Tema
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-800">Mode Tampilan</p>
            <p className="text-sm text-gray-500">Pilih tema untuk aplikasi</p>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* Notification Settings */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
        <h3 className="font-heading font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-sabana-100 flex items-center justify-center text-sm">🔔</span>
          Notifikasi
        </h3>
        <NotificationSettings />
      </div>

      {/* Backup Settings */}
      <BackupSettings />

      {/* Danger Zone */}
      <div className="bg-white rounded-2xl p-5 border border-red-200 shadow-sm">
        <h3 className="font-heading font-semibold text-red-700 mb-3 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-sm">⚠️</span>
          Zona Bahaya
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Hapus Data Hari Ini</p>
            <p className="text-xs text-gray-500">Hapus semua order, shift, dan transaksi hari ini</p>
          </div>
          <button onClick={handleResetData} className="px-4 py-2 bg-red-100 text-danger rounded-xl text-sm font-semibold hover:bg-red-200 transition-colors">
            🗑️ Hapus
          </button>
        </div>
      </div>
    </div>
  );
}
