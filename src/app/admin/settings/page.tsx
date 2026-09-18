"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { getPrinter, isBluetoothAvailable } from "@/lib/printer";
import { getReceiptSettings, saveReceiptSettings } from "@/lib/settings";
import NotificationSettings from "@/components/admin/NotificationSettings";
import ThemeToggle from "@/components/ThemeToggle";
import BackupSettings from "@/components/admin/BackupSettings";

type SettingsTab = "outlet" | "printer" | "receipt" | "features" | "portal" | "theme" | "notifications" | "backup" | "danger";

const TABS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "outlet", label: "Outlet", icon: "🏪" },
  { key: "printer", label: "Printer", icon: "🖨️" },
  { key: "receipt", label: "Struk", icon: "🧾" },
  { key: "features", label: "Fitur", icon: "⚙️" },
  { key: "portal", label: "Portal", icon: "📱" },
  { key: "theme", label: "Tema", icon: "🎨" },
  { key: "notifications", label: "Notif", icon: "🔔" },
  { key: "backup", label: "Backup", icon: "💾" },
  { key: "danger", label: "Bahaya", icon: "⚠️" },
];

interface OutletSettings { id: string; name: string; address: string; phone: string; }
interface FeatureToggles { tableSelector: boolean; onlineFood: boolean; preOrder: boolean; cashInOut: boolean; loyalty: boolean; promo: boolean; customerPortal: boolean; showHPP: boolean; }
const DEFAULT_FEATURES: FeatureToggles = { tableSelector: true, onlineFood: true, preOrder: true, cashInOut: true, loyalty: true, promo: true, customerPortal: true, showHPP: false };
const PRESET_COLORS = [
  { name: "Sabana", light: "#F97316", dark: "#F97316" },
  { name: "Merah", light: "#DC2626", dark: "#EF4444" },
  { name: "Biru", light: "#2563EB", dark: "#3B82F6" },
  { name: "Hijau", light: "#16A34A", dark: "#22C55E" },
  { name: "Ungu", light: "#9333EA", dark: "#A855F7" },
  { name: "Pink", light: "#EC4899", dark: "#F472B6" },
  { name: "Teal", light: "#0891B2", dark: "#06B6D4" },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("outlet");
  const [outlet, setOutlet] = useState<OutletSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<"checking" | "available" | "unavailable">("checking");
  const [printerConnected, setPrinterConnected] = useState(false);
  const [printerConnecting, setPrinterConnecting] = useState(false);
  const [features, setFeatures] = useState<FeatureToggles>(DEFAULT_FEATURES);
  const [receiptData, setReceiptData] = useState<{ outletName: string; outletAddress: string; outletPhone: string; footer: string; showLogo: boolean; showTime: boolean; showQRIS: boolean; autoPrint: boolean; paperWidth?: "58" | "80" }>({ outletName: "SABANA FRIED CHICKEN", outletAddress: "Jl. Contoh No. 123", outletPhone: "0812-xxxx-xxxx", footer: "Terima kasih! Sampai jumpa! 🍗", showLogo: true, showTime: true, showQRIS: false, autoPrint: false, paperWidth: "58" });
  const [brandColor, setBrandColor] = useState("#F97316");
  const [brandColorDark, setBrandColorDark] = useState("#F97316");
  const [portalTagline, setPortalTagline] = useState("Sabana");
  const [portalSubtitle, setPortalSubtitle] = useState("Ayam Goreng & Menu Favorit");
  const [portalWelcome, setPortalWelcome] = useState("Masuk ke Akun Anda");
  const [portalFooter, setPortalFooter] = useState("Dengan masuk, Anda menyetujui Syarat & Ketentuan");

  useEffect(() => {
    async function fetchData() {
      try {
        const { data: outletData } = await supabase.from("outlets").select("*").eq("id", "00000000-0000-0000-0000-000000000001").single();
        if (outletData) setOutlet(outletData);
        setPrinterStatus(isBluetoothAvailable() ? "available" : "unavailable");
        if (isBluetoothAvailable()) {
          void getPrinter().reconnect().then((connected) => setPrinterConnected(connected));
        }
        const s = localStorage.getItem("sabana-app-settings");
        if (s) { const p = JSON.parse(s); setReceiptData((r) => ({ ...r, footer: p.receipt_footer || r.footer })); setBrandColor(p.brand_color || "#F97316"); setBrandColorDark(p.brand_color_dark || "#F97316"); }
        const f = localStorage.getItem("sabana-features");
        if (f) setFeatures({ ...DEFAULT_FEATURES, ...JSON.parse(f) });
        const pt = localStorage.getItem("sabana-portal-settings");
        if (pt) { const p = JSON.parse(pt); setPortalTagline(p.portal_tagline || "Sabana"); setPortalSubtitle(p.portal_subtitle || ""); setPortalWelcome(p.portal_welcome || ""); setPortalFooter(p.portal_footer || ""); }
        const rc = getReceiptSettings();
        if (rc) setReceiptData((r) => ({ ...r, ...rc, showQRIS: rc.showQR ?? r.showQRIS }));
      } catch (err) { console.error(err); } finally { setLoading(false); }
    }
    fetchData();
  }, []);

  const saveAll = () => {
    localStorage.setItem("sabana-app-settings", JSON.stringify({ receipt_footer: receiptData.footer, brand_color: brandColor, brand_color_dark: brandColorDark }));
    localStorage.setItem("sabana-features", JSON.stringify(features));
    localStorage.setItem("sabana-portal-settings", JSON.stringify({ portal_tagline: portalTagline, portal_subtitle: portalSubtitle, portal_welcome: portalWelcome, portal_footer: portalFooter }));
    saveReceiptSettings({ ...receiptData, showQR: receiptData.showQRIS });
    document.documentElement.style.setProperty("--brand-color", brandColor);
    document.documentElement.style.setProperty("--brand-color-dark", brandColorDark);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const handleConnectPrinter = async () => {
    setPrinterConnecting(true);
    try { const p = getPrinter(); const ok = await p.connect(); setPrinterConnected(ok); alert(ok ? "✅ Printer terhubung!" : "❌ Gagal. Pastikan printer menyala dan Chrome/Edge."); } catch (e: any) { alert("Error: " + e.message); } finally { setPrinterConnecting(false); }
  };

  const handleTestPrint = async () => {
    const printer = getPrinter();
    if (!printerConnected) { alert("Hubungkan printer terlebih dahulu!"); return; }
    try {
      const ok = await printer.printReceipt({
        items: [{ name: "Ayam Reguler", qty: 1, price: 89000 }, { name: "Nasi Putih", qty: 2, price: 5000 }, { name: "Kentang Goreng", qty: 1, price: 8000 }],
        subtotal: 107000, total: 107000, amountPaid: 110000, change: 3000,
        paymentMethod: "Tunai", cashierName: "Sabana", serviceMode: "Dine In", orderNumber: "TEST-001",
        date: new Date().toLocaleString("id-ID"), outletName: receiptData.outletName,
        outletAddress: receiptData.outletAddress, outletPhone: receiptData.outletPhone,
      });
      setPrinterConnected(ok);
      alert(ok ? "✅ Test print berhasil dikirim ke printer." : "❌ Data tidak berhasil dikirim. Periksa printer, koneksi, dan characteristic BLE.");
    } catch (e: any) { alert("Gagal cetak: " + e.message); }
  };

  const handleResetData = async () => {
    if (!confirm("⚠️ Hapus semua data hari ini?")) return;
    try {
      const today = new Date().toISOString().split("T")[0];
      await supabase.from("order_items").delete().gte("created_at", today);
      await supabase.from("orders").delete().gte("created_at", today);
      await supabase.from("shifts").delete().gte("opened_at", today);
      alert("Data hari ini dihapus");
    } catch { alert("Gagal"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0f0f0f]">
      {/* Header */}
      <div className="bg-white dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-[#333] px-4 py-3 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="font-heading font-bold text-lg dark:text-gray-100">⚙️ Pengaturan</h1>
          <button onClick={saveAll} className="px-4 py-2 bg-sabana text-white rounded-xl text-sm font-semibold hover:bg-sabana-dark transition-colors">
            {saved ? "✅ Tersimpan!" : "💾 Simpan"}
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-[#333] overflow-x-auto">
        <div className="max-w-3xl mx-auto flex">
          {TABS.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex flex-col items-center gap-0.5 px-4 py-3 text-xs font-semibold whitespace-nowrap transition-all border-b-2 ${activeTab === tab.key ? "border-sabana text-sabana" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}>
              <span className="text-lg">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto p-4">
        {saved && <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3 mb-4 text-center"><p className="text-sm font-semibold text-green-800 dark:text-green-300">✅ Berhasil disimpan!</p></div>}

        {/* OUTLET TAB */}
        {activeTab === "outlet" && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm">
              <h3 className="font-heading font-semibold mb-4 dark:text-gray-100">🏪 Informasi Outlet</h3>
              {outlet && (
                <div className="space-y-3">
                  <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Nama Outlet</label><input type="text" value={outlet.name} onChange={(e) => setOutlet({ ...outlet, name: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:ring-2 focus:ring-sabana text-sm" /></div>
                  <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Alamat</label><input type="text" value={outlet.address} onChange={(e) => setOutlet({ ...outlet, address: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:ring-2 focus:ring-sabana text-sm" /></div>
                  <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">No. HP</label><input type="tel" value={outlet.phone} onChange={(e) => setOutlet({ ...outlet, phone: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:ring-2 focus:ring-sabana text-sm" /></div>
                  <button onClick={async () => { setSaving(true); await supabase.from("outlets").update({ name: outlet.name, address: outlet.address, phone: outlet.phone }).eq("id", outlet.id); setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); }} disabled={saving} className="px-6 py-2.5 bg-sabana text-white rounded-xl font-semibold text-sm disabled:opacity-50">{saving ? "Menyimpan..." : "Simpan Outlet"}</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PRINTER TAB */}
        {activeTab === "printer" && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm">
              <h3 className="font-heading font-semibold mb-4 dark:text-gray-100">🖨️ Printer Thermal</h3>
              <div className={`flex items-center gap-2 p-3 rounded-xl mb-3 ${printerStatus === "available" ? "bg-green-50 dark:bg-green-900/20 border border-green-200" : "bg-red-50 dark:bg-red-900/20 border border-red-200"}`}>
                <span className="w-3 h-3 rounded-full" style={{ color: printerStatus === "available" ? "#16a34a" : "#dc2626" }}>●</span>
                <span className="text-sm font-medium">{printerStatus === "available" ? "Web Bluetooth tersedia" : "Chrome/Edge only"}</span>
              </div>
              {printerStatus === "available" && (
                <div className={`flex items-center justify-between p-3 rounded-xl border mb-3 ${printerConnected ? "bg-green-50 dark:bg-green-900/20 border-green-200" : "bg-gray-50 dark:bg-[#222] border-gray-200 dark:border-[#444]"}`}>
                  <span className="text-sm font-medium dark:text-gray-300">{printerConnected ? "✅ Terhubung" : "❌ Belum terhubung"}</span>
                  {printerConnected ? (
                    <button onClick={() => { getPrinter().disconnect(); setPrinterConnected(false); }} className="px-3 py-1.5 text-xs font-semibold text-danger bg-red-100 rounded-lg">Putuskan</button>
                  ) : (
                    <button onClick={handleConnectPrinter} disabled={printerConnecting} className="px-4 py-1.5 text-xs font-semibold text-white bg-sabana rounded-lg disabled:opacity-50">{printerConnecting ? "..." : "🔌 Hubungkan"}</button>
                  )}
                </div>
              )}
              <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Lebar Kertas</label>
                <div className="flex gap-2">{(["58", "80"] as const).map((w) => (<button key={w} onClick={() => { setReceiptData((r) => ({ ...r, paperWidth: w })); saveReceiptSettings({ ...receiptData, paperWidth: w, showQR: receiptData.showQRIS }); }} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${(receiptData.paperWidth ?? "58") === w ? "border-sabana bg-sabana-50 text-sabana" : "border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400"}`}>{w}mm</button>))}</div>
              </div>                  <label className="mt-4 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-900/20"><input type="checkbox" checked={receiptData.autoPrint} onChange={(event) => setReceiptData((current) => ({ ...current, autoPrint: event.target.checked }))} className="mt-0.5 h-4 w-4 rounded text-sabana" /><span className="text-xs text-blue-800 dark:text-blue-200"><strong>Print otomatis setelah pembayaran</strong><br />Berjalan tanpa chooser hanya setelah printer pernah dipasangkan dan izin Bluetooth disimpan browser.</span></label>
                  <button onClick={handleTestPrint} disabled={!printerConnected} className="w-full mt-4 py-3 bg-blue-500 text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">🖨️ Test Print</button>
            </div>
          </div>
        )}

        {/* RECEIPT TAB */}
        {activeTab === "receipt" && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm">
              <h3 className="font-heading font-semibold mb-4 dark:text-gray-100">🧾 Pengaturan Struk</h3>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Nama Outlet di Struk</label><input type="text" value={receiptData.outletName} onChange={(e) => setReceiptData({ ...receiptData, outletName: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Alamat di Struk</label><input type="text" value={receiptData.outletAddress} onChange={(e) => setReceiptData({ ...receiptData, outletAddress: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">No. HP di Struk</label><input type="text" value={receiptData.outletPhone} onChange={(e) => setReceiptData({ ...receiptData, outletPhone: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Footer Struk</label><textarea value={receiptData.footer} onChange={(e) => setReceiptData({ ...receiptData, footer: e.target.value })} rows={2} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm resize-none" /></div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={receiptData.showLogo} onChange={(e) => setReceiptData({ ...receiptData, showLogo: e.target.checked })} className="w-4 h-4 text-sabana rounded" /><span className="text-sm dark:text-gray-300">Tampilkan Logo</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={receiptData.showTime} onChange={(e) => setReceiptData({ ...receiptData, showTime: e.target.checked })} className="w-4 h-4 text-sabana rounded" /><span className="text-sm dark:text-gray-300">Tampilkan Waktu</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={receiptData.showQRIS} onChange={(e) => setReceiptData({ ...receiptData, showQRIS: e.target.checked })} className="w-4 h-4 text-sabana rounded" /><span className="text-sm dark:text-gray-300">QR Code</span></label>
                </div>
              </div>
            </div>
            {/* Receipt Preview */}
            <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm">
              <h3 className="font-heading font-semibold mb-3 dark:text-gray-100">👁️ Preview Struk</h3>
              <div className="bg-gray-100 dark:bg-[#222] rounded-xl p-4 font-mono text-xs leading-relaxed max-w-[280px] mx-auto">
                <div className="text-center border-b border-dashed border-gray-300 dark:border-[#444] pb-3 mb-3">
                  {receiptData.showLogo && <p className="text-lg font-bold">🍗</p>}
                  <p className="font-bold text-sm">{receiptData.outletName}</p>
                  <p className="text-gray-500 dark:text-gray-400">{receiptData.outletAddress}</p>
                  <p className="text-gray-500 dark:text-gray-400">{receiptData.outletPhone}</p>
                </div>
                {receiptData.showTime && <p className="text-gray-500 dark:text-gray-400 mb-2">{new Date().toLocaleString("id-ID")}</p>}
                <div className="border-b border-dashed border-gray-300 dark:border-[#444] pb-2 mb-2">
                  <div className="flex justify-between"><span>1x Ayam Reguler</span><span>Rp 89.000</span></div>
                  <div className="flex justify-between"><span>2x Nasi Putih</span><span>Rp 10.000</span></div>
                  <div className="flex justify-between"><span>1x Kentang Goreng</span><span>Rp 8.000</span></div>
                </div>
                <div className="space-y-1 mb-2">
                  <div className="flex justify-between"><span>Subtotal</span><span>Rp 107.000</span></div>
                  <div className="flex justify-between font-bold"><span>TOTAL</span><span>Rp 107.000</span></div>
                  <div className="flex justify-between"><span>BAYAR</span><span>Rp 110.000</span></div>
                  <div className="flex justify-between"><span>KEMBALI</span><span>Rp 3.000</span></div>
                </div>
                <div className="border-t border-dashed border-gray-300 dark:border-[#444] pt-3 text-center">
                  <p className="font-bold">Terima kasih!</p>
                  <p className="text-gray-500 dark:text-gray-400 text-[10px]">{receiptData.footer}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FEATURES TAB */}
        {activeTab === "features" && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm">
              <h3 className="font-heading font-semibold mb-4 dark:text-gray-100">⚙️ Toggle Fitur POS</h3>
              <p className="text-xs text-gray-400 mb-4">Aktifkan/nonaktifkan menu yang digunakan</p>
              <div className="space-y-1">
                {([
                  { key: "tableSelector" as const, icon: "🪑", label: "Pilih Meja", desc: "Tampilkan pemilihan meja saat Dine In" },
                  { key: "onlineFood" as const, icon: "🛵", label: "Online Food", desc: "GoFood, GrabFood, ShopeeFood" },
                  { key: "preOrder" as const, icon: "📅", label: "Pre-Order", desc: "Pesan untuk acara dengan DP" },
                  { key: "cashInOut" as const, icon: "💰", label: "Cash In/Out", desc: "Catat uang masuk/keluar kas" },
                  { key: "loyalty" as const, icon: "⭐", label: "Loyalty", desc: "Program poin dan stamp" },
                  { key: "promo" as const, icon: "🏷️", label: "Promo & Diskon", desc: "Terapkan promo pada transaksi" },
                  { key: "customerPortal" as const, icon: "📱", label: "Customer Portal", desc: "Halaman order online" },
                  { key: "showHPP" as const, icon: "💰", label: "Tampilkan HPP", desc: "Harga pokok penjualan di admin" },
                ]).map((f) => (
                  <div key={f.key} className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-[#333] last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{f.icon}</span>
                      <div><p className="font-medium text-sm dark:text-gray-200">{f.label}</p><p className="text-xs text-gray-400">{f.desc}</p></div>
                    </div>
                    <button onClick={() => setFeatures({ ...features, [f.key]: !features[f.key] })} className={`relative w-12 h-7 rounded-full transition-colors ${features[f.key] ? "bg-success" : "bg-gray-300 dark:bg-[#444]"}`}>
                      <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${features[f.key] ? "left-6" : "left-1"}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PORTAL TAB */}
        {activeTab === "portal" && (
          <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm">
            <h3 className="font-heading font-semibold mb-4 dark:text-gray-100">📱 Portal Customer</h3>
            <div className="space-y-3">
              <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Nama Brand</label><input type="text" value={portalTagline} onChange={(e) => setPortalTagline(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm" /></div>
              <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Subtitle</label><input type="text" value={portalSubtitle} onChange={(e) => setPortalSubtitle(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm" /></div>
              <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Judul Login</label><input type="text" value={portalWelcome} onChange={(e) => setPortalWelcome(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm" /></div>
              <div><label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Footer</label><input type="text" value={portalFooter} onChange={(e) => setPortalFooter(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-sm" /></div>
            </div>
          </div>
        )}

        {/* THEME TAB */}
        {activeTab === "theme" && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm">
              <h3 className="font-heading font-semibold mb-4 dark:text-gray-100">🎨 Warna Brand</h3>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 rounded-xl p-4 text-white text-center" style={{ backgroundColor: brandColor }}><p className="font-bold text-sm">Preview</p><p className="text-xs opacity-80">{brandColor}</p></div>
                <div className="flex-1 rounded-xl p-4 text-white text-center" style={{ backgroundColor: brandColorDark }}><p className="font-bold text-sm">Dark Mode</p><p className="text-xs opacity-80">{brandColorDark}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Light Mode</label><div className="flex items-center gap-2"><input type="color" value={brandColor} onChange={(e) => { setBrandColor(e.target.value); document.documentElement.style.setProperty("--brand-color", e.target.value); }} className="w-10 h-10 rounded-lg border-0 cursor-pointer" /><input type="text" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-xs font-mono" /></div></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Dark Mode</label><div className="flex items-center gap-2"><input type="color" value={brandColorDark} onChange={(e) => { setBrandColorDark(e.target.value); document.documentElement.style.setProperty("--brand-color-dark", e.target.value); }} className="w-10 h-10 rounded-lg border-0 cursor-pointer" /><input type="text" value={brandColorDark} onChange={(e) => setBrandColorDark(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 text-xs font-mono" /></div></div>
              </div>
              <div className="flex gap-2 flex-wrap">{PRESET_COLORS.map((p) => (<button key={p.name} onClick={() => { setBrandColor(p.light); setBrandColorDark(p.dark); document.documentElement.style.setProperty("--brand-color", p.light); document.documentElement.style.setProperty("--brand-color-dark", p.dark); }} className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-xs font-medium ${brandColor === p.light ? "border-sabana bg-sabana-50" : "border-gray-200 dark:border-[#444]"}`}><span className="w-4 h-4 rounded-full" style={{ backgroundColor: p.light }} /><span className="dark:text-gray-300">{p.name}</span></button>))}</div>
            </div>
            <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm">
              <h3 className="font-heading font-semibold mb-3 dark:text-gray-100">🌓 Mode Tampilan</h3>
              <div className="flex items-center justify-between"><p className="dark:text-gray-300">Pilih tema aplikasi</p><ThemeToggle /></div>
            </div>
          </div>
        )}

        {/* NOTIFICATIONS TAB */}
        {activeTab === "notifications" && (
          <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-gray-200 dark:border-[#333] shadow-sm">
            <NotificationSettings />
          </div>
        )}

        {/* BACKUP TAB */}
        {activeTab === "backup" && <BackupSettings />}

        {/* DANGER TAB */}
        {activeTab === "danger" && (
          <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-5 border border-red-200 dark:border-red-800 shadow-sm">
            <h3 className="font-heading font-semibold text-red-700 dark:text-red-400 mb-3">⚠️ Zona Bahaya</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Hapus semua data transaksi hari ini. Tindakan ini tidak dapat dibatalkan.</p>
            <button onClick={handleResetData} className="px-6 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors">🗑️ Hapus Data Hari Ini</button>
          </div>
        )}
      </div>
    </div>
  );
}
