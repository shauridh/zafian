"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { getPrinter, isBluetoothAvailable } from "@/lib/printer";
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
  brand_color: string;
  brand_color_dark: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  printer_name: "",
  printer_width: "58",
  low_stock_threshold: 10,
  auto_sync_interval: 30,
  receipt_footer: "Terima kasih! Sampai jumpa! 🍗 Sabana Fried Chicken 🍗",
  currency: "IDR",
  brand_color: "#F97316",
  brand_color_dark: "#F97316",
};

const PRESET_COLORS = [
  { name: "Sabana (Orange)", light: "#F97316", dark: "#F97316" },
  { name: "Merah", light: "#DC2626", dark: "#EF4444" },
  { name: "Biru", light: "#2563EB", dark: "#3B82F6" },
  { name: "Hijau", light: "#16A34A", dark: "#22C55E" },
  { name: "Ungu", light: "#9333EA", dark: "#A855F7" },
  { name: "Pink", light: "#EC4899", dark: "#F472B6" },
  { name: "Teal", light: "#0891B2", dark: "#06B6D4" },
];

interface CustomerPortalSettings {
  portal_tagline: string;
  portal_subtitle: string;
  portal_welcome: string;
  portal_footer: string;
}

const DEFAULT_PORTAL: CustomerPortalSettings = {
  portal_tagline: "Sabana",
  portal_subtitle: "Ayam Goreng & Menu Favorit",
  portal_welcome: "Masuk ke Akun Anda",
  portal_footer: "Dengan masuk, Anda menyetujui Syarat & Ketentuan",
};

export default function SettingsPage() {
  const [outlet, setOutlet] = useState<OutletSettings | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<"checking" | "available" | "unavailable">("checking");
  const [printerConnected, setPrinterConnected] = useState(false);
  const [printerConnecting, setPrinterConnecting] = useState(false);
  const [portalSettings, setPortalSettings] = useState<CustomerPortalSettings>(DEFAULT_PORTAL);

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
        // Apply brand color CSS variables
        const parsed = savedSettings ? JSON.parse(savedSettings) : DEFAULT_SETTINGS;
        document.documentElement.style.setProperty("--brand-color", parsed.brand_color || DEFAULT_SETTINGS.brand_color);

        // Load portal settings
        const savedPortal = localStorage.getItem("sabana-portal-settings");
        if (savedPortal) {
          setPortalSettings({ ...DEFAULT_PORTAL, ...JSON.parse(savedPortal) });
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
  };const handleSaveSettings = () => {
    localStorage.setItem("sabana-app-settings", JSON.stringify(settings));
    localStorage.setItem("sabana-portal-settings", JSON.stringify(portalSettings));
    // Apply brand color
    document.documentElement.style.setProperty("--brand-color", settings.brand_color);
    document.documentElement.classList.toggle("brand-dark", true);
    document.documentElement.style.setProperty("--brand-color-dark", settings.brand_color_dark);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleApplyPreset = (preset: typeof PRESET_COLORS[0]) => {
    setSettings({ ...settings, brand_color: preset.light, brand_color_dark: preset.dark });
    document.documentElement.style.setProperty("--brand-color", preset.light);
    document.documentElement.style.setProperty("--brand-color-dark", preset.dark);
  };

const handleConnectPrinter = async () => {
    setPrinterConnecting(true);
    try {
      const printer = getPrinter();
      console.log("[Settings] Starting printer connection...");
      const connected = await printer.connect();
      console.log("[Settings] Printer connection result:", connected);
      setPrinterConnected(connected);
      if (connected) {
        setSettings({ ...settings, printer_name: "Printer Terhubung" });
        alert("✅ Printer berhasil terhubung!");
      } else {
        alert("❌ Gagal terhubung ke printer. Pastikan:\n1. Printer menyala dan dalam mode pairing\n2. Menggunakan Chrome atau Edge\n3. Bluetooth aktif di tablet/laptop");
      }
    } catch (err: any) {
      console.error("[Settings] Printer connection error:", err);
      alert("Gagal koneksi printer: " + err.message);
    } finally {
      setPrinterConnecting(false);
    }
  };

  const handleDisconnectPrinter = () => {
    const printer = getPrinter();
    printer.disconnect();
    setPrinterConnected(false);
    setSettings({ ...settings, printer_name: "" });
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
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm mb-4">
        <h3 className="font-heading font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-sabana-100 dark:bg-sabana/20 flex items-center justify-center text-sm">🖨️</span>
          Printer Thermal
        </h3>
        <div className="space-y-3">
          {/* Bluetooth Status */}
          <div className={`flex items-center gap-2 p-3 rounded-xl ${printerStatus === "available" ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"}`}>
            <span className="w-3 h-3 rounded-full bg-current" style={{ color: printerStatus === "available" ? "#16a34a" : "#dc2626" }} />
            <span className="text-sm font-medium">
              {printerStatus === "available" ? "Web Bluetooth tersedia" : "Web Bluetooth tidak tersedia (Chrome/Edge only)"}
            </span>
          </div>

          {/* Connection Status */}
          {printerStatus === "available" && (
            <div className={`flex items-center justify-between p-3 rounded-xl border ${printerConnected ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-gray-50 dark:bg-[#222] border-gray-200 dark:border-[#444]"}`}>
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${printerConnected ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {printerConnected ? `Terhubung: ${settings.printer_name || "Printer"}` : "Belum terhubung"}
                </span>
              </div>
              {printerConnected ? (
                <div className="flex gap-2">
                  <button
                    onClick={handleDisconnectPrinter}
                    className="px-3 py-1.5 text-xs font-semibold text-danger bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                  >
                    Putuskan
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectPrinter}
                  disabled={printerConnecting}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-sabana rounded-lg hover:bg-sabana-dark transition-colors disabled:opacity-50"
                >
                  {printerConnecting ? (
                    <span className="flex items-center gap-1">
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Menghubungkan...
                    </span>
                  ) : "🔌 Hubungkan"}
                </button>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Lebar Kertas</label>
            <div className="flex gap-2">
              {(["58", "80"] as const).map((w) => (
                <button key={w} onClick={() => setSettings({ ...settings, printer_width: w })} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${settings.printer_width === w ? "border-sabana bg-sabana-50 dark:bg-sabana/20 text-sabana" : "border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-[#555]"}`}>
                  {w}mm
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Customer Portal Caption */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm mb-4">
        <h3 className="font-heading font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-sabana-100 dark:bg-sabana/20 flex items-center justify-center text-sm">📱</span>
          Portal Customer
        </h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Atur caption yang tampil di halaman login customer portal</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Nama Brand</label>
            <input type="text" value={portalSettings.portal_tagline} onChange={(e) => setPortalSettings({ ...portalSettings, portal_tagline: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Subtitle</label>
            <input type="text" value={portalSettings.portal_subtitle} onChange={(e) => setPortalSettings({ ...portalSettings, portal_subtitle: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Judul Login</label>
            <input type="text" value={portalSettings.portal_welcome} onChange={(e) => setPortalSettings({ ...portalSettings, portal_welcome: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Footer</label>
            <input type="text" value={portalSettings.portal_footer} onChange={(e) => setPortalSettings({ ...portalSettings, portal_footer: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
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
            {saved ? "✅ Tersimpan!" : "Simpan Semua Pengaturan"}
          </button>
        </div>
      </div>

      {/* Brand Color Settings */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm mb-4">
        <h3 className="font-heading font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-sabana-100 dark:bg-sabana/20 flex items-center justify-center text-sm">🎨</span>
          Warna Brand
        </h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Kustomisasi warna utama aplikasi</p>
        
        {/* Color Preview */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 rounded-xl p-4 text-white text-center" style={{ backgroundColor: settings.brand_color }}>
            <p className="font-bold">Preview Light</p>
            <p className="text-xs opacity-80">{settings.brand_color}</p>
          </div>
          <div className="flex-1 rounded-xl p-4 text-white text-center" style={{ backgroundColor: settings.brand_color_dark }}>
            <p className="font-bold">Preview Dark</p>
            <p className="text-xs opacity-80">{settings.brand_color_dark}</p>
          </div>
        </div>

        {/* Color Pickers */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Warna (Light Mode)</label>
            <div className="flex items-center gap-2">
              <input type="color" value={settings.brand_color} onChange={(e) => { setSettings({ ...settings, brand_color: e.target.value }); document.documentElement.style.setProperty("--brand-color", e.target.value); }} className="w-10 h-10 rounded-lg border-0 cursor-pointer" />
              <input type="text" value={settings.brand_color} onChange={(e) => setSettings({ ...settings, brand_color: e.target.value })} className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Warna (Dark Mode)</label>
            <div className="flex items-center gap-2">
              <input type="color" value={settings.brand_color_dark} onChange={(e) => { setSettings({ ...settings, brand_color_dark: e.target.value }); document.documentElement.style.setProperty("--brand-color-dark", e.target.value); }} className="w-10 h-10 rounded-lg border-0 cursor-pointer" />
              <input type="text" value={settings.brand_color_dark} onChange={(e) => setSettings({ ...settings, brand_color_dark: e.target.value })} className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm font-mono" />
            </div>
          </div>
        </div>

        {/* Preset Colors */}
        <div>
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Preset Warna</label>
          <div className="flex gap-2 flex-wrap">
            {PRESET_COLORS.map((preset) => (
              <button key={preset.name} onClick={() => handleApplyPreset(preset)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-xs font-medium transition-all ${settings.brand_color === preset.light ? "border-sabana bg-sabana-50 dark:bg-sabana/10" : "border-gray-200 dark:border-[#444] hover:border-gray-300 dark:hover:border-[#555]"}`}>
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: preset.light }} />
                <span className="text-gray-700 dark:text-gray-300">{preset.name}</span>
              </button>
            ))}
          </div>
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
