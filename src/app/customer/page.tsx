"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import OrderStatusTimeline from "@/components/customer/OrderStatusTimeline";

type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  points: number;
  stamps: number;
  tier: "bronze" | "silver" | "gold" | "platinum";
  created_at: string;
};

type Order = {
  id: string;
  created_at: string;
  total: number;
  payment_method: string;
  status: string;
  order_items?: { name: string; qty: number; price: number }[];
};

const DEFAULT_PORTAL = {
  portal_tagline: "Sabana",
  portal_subtitle: "Ayam Goreng & Menu Favorit",
  portal_welcome: "Masuk ke Akun Anda",
  portal_footer: "Dengan masuk, Anda menyetujui Syarat & Ketentuan",
};

const TIER_CONFIG = {
  bronze: { name: "Bronze", color: "from-amber-600 to-amber-800", icon: "🥉", min: 0 },
  silver: { name: "Silver", color: "from-gray-400 to-gray-600", icon: "🥈", min: 500 },
  gold: { name: "Gold", color: "from-yellow-400 to-yellow-600", icon: "🥇", min: 2000 },
  platinum: { name: "Platinum", color: "from-purple-500 to-purple-700", icon: "💎", min: 5000 },
};

type NavTab = "home" | "orders" | "rewards" | "account";

export default function CustomerPortal() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [now, setNow] = useState<Date | null>(null);
  const [portalConfig, setPortalConfig] = useState(DEFAULT_PORTAL);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editEmail, setEditEmail] = useState("");

  useEffect(() => {
    setNow(new Date());
    const saved = localStorage.getItem("sabana-portal-settings");
    if (saved) setPortalConfig({ ...DEFAULT_PORTAL, ...JSON.parse(saved) });
  }, []);

  // Send OTP via WhatsApp
  const sendOTP = async () => {
    if (!phone || phone.length < 10) { setError("Nomor HP tidak valid"); return; }
    setLoading(true); setError("");
    try {
      const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();
      const { error: otpError } = await supabase
        .from("customers")
        .upsert({ phone, otp_code: generatedOTP, otp_expires: new Date(Date.now() + 5 * 60000).toISOString() }, { onConflict: "phone" });
      if (otpError) throw otpError;
      console.log(`[WhatsApp OTP] Sent to ${phone}: ${generatedOTP}`);
      setOtpSent(true);
    } catch (err: any) { setError(err.message || "Gagal mengirim OTP"); }
    finally { setLoading(false); }
  };

  const verifyOTP = async () => {
    if (!otp || otp.length !== 6) { setError("Kode OTP harus 6 digit"); return; }
    setLoading(true); setError("");
    try {
      const { data, error: verifyError } = await supabase
        .from("customers").select("*").eq("phone", phone).eq("otp_code", otp).gt("otp_expires", new Date().toISOString()).single();
      if (verifyError || !data) throw new Error("Kode OTP salah atau sudah expired");
      await supabase.from("customers").update({ otp_code: null, otp_expires: null }).eq("phone", phone);
      setCustomer(data);
      setOtpVerified(true);
      setEditName(data.name || "");
      setEditAddress(data.address || "");
      setEditCity(data.city || "");
      setEditEmail(data.email || "");
      await fetchCustomerOrders(data.id);
    } catch (err: any) { setError(err.message || "Verifikasi OTP gagal"); }
    finally { setLoading(false); }
  };

  const fetchCustomerOrders = async (customerId: string) => {
    try {
      const { data, error } = await supabase
        .from("orders").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      setOrders(data || []);
    } catch (err) { console.error("Failed to fetch orders:", err); }
  };

  const logout = () => { setCustomer(null); setOtpVerified(false); setOtpSent(false); setPhone(""); setOtp(""); setOrders([]); setActiveTab("home"); };

  const saveProfile = async () => {
    if (!customer) return;
    setSavingProfile(true);
    try {
      await supabase.from("customers").update({ name: editName, address: editAddress, city: editCity, email: editEmail }).eq("id", customer.id);
      setCustomer({ ...customer, name: editName, address: editAddress, city: editCity, email: editEmail });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (err: any) { alert("Gagal menyimpan: " + err.message); }
    finally { setSavingProfile(false); }
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(amount);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 11) return "Selamat Pagi";
    if (h < 15) return "Selamat Siang";
    if (h < 18) return "Selamat Sore";
    return "Selamat Malam";
  };

  const getTierProgress = () => {
    if (!customer) return { current: TIER_CONFIG.bronze, next: TIER_CONFIG.silver, progress: 0 };
    const tiers = Object.values(TIER_CONFIG);
    const idx = tiers.findIndex(t => t.name.toLowerCase() === customer.tier);
    const nextIdx = idx + 1;
    if (nextIdx >= tiers.length) return { current: tiers[idx], next: null, progress: 100 };
    const current = tiers[idx]; const next = tiers[nextIdx];
    const progress = ((customer.points - current.min) / (next.min - current.min)) * 100;
    return { current, next, progress: Math.min(progress, 100) };
  };

  // ==================== LOGIN ====================
  if (!otpVerified) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sabana via-sabana-dark to-sabana-darker flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-24 h-24 bg-white rounded-3xl shadow-xl mx-auto mb-4 flex items-center justify-center">
              <span className="text-4xl font-extrabold text-sabana">S</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white">{portalConfig.portal_tagline}</h1>
            <p className="text-white/70 text-sm mt-1">{portalConfig.portal_subtitle}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-1">{portalConfig.portal_welcome}</h2>
            <p className="text-gray-500 text-sm mb-6">Masukkan nomor HP untuk login via WhatsApp</p>
            {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4"><p className="text-red-600 text-sm">{error}</p></div>}
            {!otpSent ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nomor HP</label>
                  <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus:ring-sabana">
                    <span className="px-3 py-3 bg-gray-50 text-gray-500 text-sm border-r border-gray-200">+62</span>
                    <input type="tel" value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 12)); setError(""); }} placeholder="8123456789" className="flex-1 px-3 py-3 focus:outline-none text-lg tracking-wider" />
                  </div>
                </div>
                <button onClick={sendOTP} disabled={loading || phone.length < 10} className="w-full py-3 rounded-xl font-bold text-white transition-colors disabled:opacity-50" style={{ background: "#25D366" }}>
                  {loading ? "Mengirim..." : "Kirim OTP via WhatsApp"}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-green-700 text-sm">✅ OTP dikirim ke <strong>+62{phone}</strong></p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Kode OTP</label>
                  <input type="text" inputMode="numeric" value={otp} onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} placeholder="123456" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-sabana" />
                </div>
                <button onClick={verifyOTP} disabled={loading || otp.length !== 6} className="w-full py-3 rounded-xl bg-sabana text-white font-bold hover:bg-sabana-dark transition-colors disabled:opacity-50">
                  {loading ? "Verifikasi..." : "Verifikasi OTP"}
                </button>
                <div className="flex gap-4">
                  <button onClick={() => { setOtpSent(false); setOtp(""); setError(""); }} className="flex-1 py-2 text-sm text-gray-500 hover:text-gray-700">Ganti nomor</button>
                  <button onClick={sendOTP} disabled={loading} className="flex-1 py-2 text-sm text-sabana hover:text-sabana-dark font-medium">Kirim ulang</button>
                </div>
              </div>
            )}
          </div>
          <p className="text-center text-white/50 text-xs mt-6">{portalConfig.portal_footer}</p>
        </div>
      </div>
    );
  }

  // ==================== MAIN APP ====================
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-sabana to-sabana-dark rounded-xl flex items-center justify-center shadow-md">
              <span className="text-white font-extrabold text-lg">S</span>
            </div>
            <div>
              <h1 className="font-bold text-gray-800 text-sm">{portalConfig.portal_tagline}</h1>
              <p className="text-[10px] text-gray-400">{portalConfig.portal_subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${TIER_CONFIG[customer?.tier || "bronze"].color} flex items-center justify-center text-sm`}>
              {TIER_CONFIG[customer?.tier || "bronze"].icon}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-lg mx-auto">
        {/* HOME TAB */}
        {activeTab === "home" && (
          <div className="px-4 pt-4 space-y-4">
            {/* Greeting Card */}
            <div className="bg-gradient-to-br from-sabana via-sabana-dark to-sabana-darker rounded-3xl p-6 text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-20 translate-x-20" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-16 -translate-x-16" />
              <div className="relative z-10">
                <p className="text-white/60 text-sm mb-1">{getGreeting()} 👋</p>
                <h2 className="text-2xl font-extrabold mb-1">{customer?.name || "Pelanggan"}</h2>
                <p className="text-white/60 text-xs mb-4">Member {TIER_CONFIG[customer?.tier || "bronze"].name}</p>
                <div className="flex gap-3">
                  <div className="flex-1 bg-white/10 backdrop-blur-sm rounded-2xl p-3 text-center">
                    <p className="text-2xl font-extrabold">{customer?.points || 0}</p>
                    <p className="text-[10px] text-white/60">Poin</p>
                  </div>
                  <div className="flex-1 bg-white/10 backdrop-blur-sm rounded-2xl p-3 text-center">
                    <p className="text-2xl font-extrabold">{customer?.stamps || 0}/10</p>
                    <p className="text-[10px] text-white/60">Stamp</p>
                  </div>
                  <div className="flex-1 bg-white/10 backdrop-blur-sm rounded-2xl p-3 text-center">
                    <p className="text-2xl font-extrabold">{orders.length}</p>
                    <p className="text-[10px] text-white/60">Order</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Tier Progress */}
            {(() => { const tp = getTierProgress(); return tp.next ? (
              <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-700">Progress ke {tp.next.name}</span>
                  <span className="text-xs text-sabana font-bold">{Math.round(tp.progress)}%</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-gradient-to-r from-sabana to-sabana-dark rounded-full transition-all duration-700" style={{ width: `${tp.progress}%` }} />
                </div>
                <p className="text-xs text-gray-400">{tp.next.min - (customer?.points || 0)} poin lagi ke {tp.next.name} {tp.next.icon}</p>
              </div>
            ) : null; })()}

            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setActiveTab("orders")} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm text-left hover:shadow-md transition-shadow">
                <span className="text-2xl mb-2 block">🧾</span>
                <p className="font-semibold text-gray-800 text-sm">Riwayat Order</p>
                <p className="text-xs text-gray-400">{orders.length} transaksi</p>
              </button>
              <button onClick={() => setActiveTab("rewards")} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm text-left hover:shadow-md transition-shadow">
                <span className="text-2xl mb-2 block">🎁</span>
                <p className="font-semibold text-gray-800 text-sm">Reward Saya</p>
                <p className="text-xs text-gray-400">{customer?.stamps || 0} stamp</p>
              </button>
            </div>

            {/* Recent Orders */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800">Order Terakhir</h3>
                <button onClick={() => setActiveTab("orders")} className="text-xs text-sabana font-medium">Lihat Semua →</button>
              </div>
              {orders.length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <p className="text-3xl mb-2">🛒</p>
                  <p className="text-sm">Belum ada order</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.slice(0, 3).map((order) => (
                    <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{order.id.slice(0, 8)}...</p>
                        <p className="text-[10px] text-gray-400">{new Date(order.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-800">{formatCurrency(order.total)}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${order.status === "completed" ? "bg-green-100 text-green-700" : order.status === "pending" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>
                          {order.status === "completed" ? "Selesai" : order.status === "pending" ? "Diproses" : order.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ORDERS TAB */}
        {activeTab === "orders" && (
          <div className="px-4 pt-4 space-y-3">
            <h2 className="text-lg font-bold text-gray-800">Riwayat Order</h2>
            {orders.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 border border-gray-100 text-center">
                <span className="text-5xl mb-3 block">🧾</span>
                <p className="text-gray-500 font-medium">Belum ada transaksi</p>
                <p className="text-xs text-gray-400 mt-1">Orderan kamu akan muncul di sini</p>
              </div>
            ) : (
              orders.map((order) => (
                <div key={order.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-bold text-gray-800 text-sm">{order.id.slice(0, 8)}...</p>
                      <p className="text-[10px] text-gray-400">{new Date(order.created_at).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${order.status === "completed" ? "bg-green-100 text-green-700" : order.status === "pending" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>
                      {order.status === "completed" ? "✅ Selesai" : order.status === "pending" ? "⏳ Diproses" : order.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">{order.payment_method === "cash" ? "💵 Tunai" : order.payment_method === "qris" ? "📱 QRIS" : order.payment_method}</span>
                    </div>
                    <span className="font-extrabold text-sabana">{formatCurrency(order.total)}</span>
                  </div>
                  <OrderStatusTimeline status={order.status} />
                </div>
              ))
            )}
          </div>
        )}

        {/* REWARDS TAB */}
        {activeTab === "rewards" && (
          <div className="px-4 pt-4 space-y-4">
            <h2 className="text-lg font-bold text-gray-800">Reward & Stamp</h2>
            {/* Stamp Card */}
            <div className="bg-gradient-to-br from-sabana to-sabana-dark rounded-3xl p-5 text-white">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Stamp Card</h3>
                <span className="text-sm text-white/60">{customer?.stamps || 0}/10</span>
              </div>
              <div className="grid grid-cols-5 gap-2 mb-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className={`w-full aspect-square rounded-xl flex items-center justify-center text-lg ${(customer?.stamps || 0) > i ? "bg-white text-sabana shadow-lg" : "bg-white/10 text-white/30"}`}>
                    {(customer?.stamps || 0) > i ? "🍗" : ""}
                  </div>
                ))}
              </div>
              <p className="text-xs text-white/60 text-center">Kumpulkan 10 stamp untuk reward Rp 15.000</p>
            </div>

            {/* Available Rewards */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-3">Reward Tersedia</h3>
              <div className="space-y-2">
                <div className={`flex items-center gap-3 p-4 rounded-xl border ${(customer?.stamps || 0) >= 10 ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-100"}`}>
                  <span className="text-3xl">🎁</span>
                  <div className="flex-1">
                    <p className={`font-bold ${(customer?.stamps || 0) >= 10 ? "text-green-800" : "text-gray-700"}`}>Diskon Rp 15.000</p>
                    <p className="text-xs text-gray-400">Berlaku 30 hari setelah diklaim</p>
                  </div>
                  <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${(customer?.stamps || 0) >= 10 ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"}`}>
                    {(customer?.stamps || 0) >= 10 ? "Aktif ✓" : "Terkunci 🔒"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ACCOUNT TAB */}
        {activeTab === "account" && (
          <div className="px-4 pt-4 space-y-4">
            <h2 className="text-lg font-bold text-gray-800">Akun Saya</h2>

            {/* Profile Header */}
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-sabana to-sabana-dark flex items-center justify-center text-3xl text-white font-extrabold mx-auto mb-3 shadow-lg">
                {(customer?.name || "P").charAt(0).toUpperCase()}
              </div>
              <h3 className="font-bold text-gray-800 text-lg">{customer?.name || "Pelanggan"}</h3>
              <p className="text-sm text-gray-500">+62{customer?.phone}</p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className={`px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r ${TIER_CONFIG[customer?.tier || "bronze"].color} text-white`}>
                  {TIER_CONFIG[customer?.tier || "bronze"].icon} {TIER_CONFIG[customer?.tier || "bronze"].name}
                </span>
              </div>
            </div>

            {/* Edit Profile */}
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-4">Edit Profil</h3>
              {profileSaved && <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 text-center"><p className="text-sm font-semibold text-green-700">✅ Berhasil disimpan!</p></div>}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nama Lengkap</label>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                  <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email@contoh.com" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Alamat</label>
                  <textarea value={editAddress} onChange={(e) => setEditAddress(e.target.value)} rows={2} placeholder="Jl. Contoh No. 123" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Kota</label>
                  <input type="text" value={editCity} onChange={(e) => setEditCity(e.target.value)} placeholder="Jakarta" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
                </div>
                <button onClick={saveProfile} disabled={savingProfile} className="w-full py-3 bg-sabana text-white rounded-xl font-bold hover:bg-sabana-dark transition-colors disabled:opacity-50">
                  {savingProfile ? "Menyimpan..." : "💾 Simpan Profil"}
                </button>
              </div>
            </div>

            {/* Membership Info */}
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-3">Keanggotaan</h3>
              <div className="space-y-2">
                <div className="flex justify-between"><span className="text-gray-500 text-sm">Member Sejak</span><span className="font-medium text-sm">{now ? new Date(customer?.created_at || "").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "..."}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-sm">Total Poin</span><span className="font-bold text-sabana">{customer?.points || 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-sm">Total Stamp</span><span className="font-bold text-sabana">{customer?.stamps || 0}</span></div>
              </div>
            </div>

            {/* Logout */}
            <button onClick={logout} className="w-full py-3 bg-red-50 text-danger rounded-xl font-bold hover:bg-red-100 transition-colors text-sm">
              🚪 Keluar
            </button>
          </div>
        )}
      </div>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-50 safe-bottom">
        <div className="max-w-lg mx-auto flex">
          {([
            { key: "home" as const, icon: "🏠", label: "Beranda" },
            { key: "orders" as const, icon: "🧾", label: "Order" },
            { key: "rewards" as const, icon: "🎁", label: "Reward" },
            { key: "account" as const, icon: "👤", label: "Akun" },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex flex-col items-center py-2 pt-3 transition-colors ${
                activeTab === tab.key ? "text-sabana" : "text-gray-400"
              }`}
            >
              <span className="text-xl mb-0.5">{tab.icon}</span>
              <span className="text-[10px] font-semibold">{tab.label}</span>
              {activeTab === tab.key && <div className="w-6 h-0.5 bg-sabana rounded-full mt-1" />}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
