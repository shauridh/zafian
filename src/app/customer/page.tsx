"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

type Customer = {
  id: string;
  name: string;
  phone: string;
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
};

const TIER_CONFIG = {
  bronze: { name: "Bronze", color: "bg-amber-700", min: 0 },
  silver: { name: "Silver", color: "bg-gray-400", min: 500 },
  gold: { name: "Gold", color: "bg-yellow-500", min: 2000 },
  platinum: { name: "Platinum", color: "bg-purple-600", min: 5000 },
};

export default function CustomerPortal() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<"profile" | "orders">("profile");
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  // Send OTP via WhatsApp
  const sendOTP = async () => {
    if (!phone || phone.length < 10) {
      setError("Nomor HP tidak valid");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Generate random OTP
      const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Store OTP in Supabase (in real app, use a dedicated OTP table)
      const { error: otpError } = await supabase
        .from("customers")
        .upsert({
          phone: phone,
          otp_code: generatedOTP,
          otp_expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
        }, { onConflict: "phone" });

      if (otpError) throw otpError;

      // Send OTP via WhatsApp API (simulated)
      const whatsappMessage = `*Sabana POS*\n\nKode OTP Anda: *${generatedOTP}\n\nBerlaku 5 menit. Jangan bagikan kode ini ke siapapun.`;
      
      // In production, use WhatsApp Business API
      // await fetch('/api/whatsapp/send', {
      //   method: 'POST',
      //   body: JSON.stringify({ phone, message: whatsappMessage })
      // });

      console.log(`[WhatsApp OTP] Sent to ${phone}: ${generatedOTP}`);
      console.log(`[WhatsApp Message] ${whatsappMessage}`);

      setOtpSent(true);
    } catch (err: any) {
      setError(err.message || "Gagal mengirim OTP");
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP
  const verifyOTP = async () => {
    if (!otp || otp.length !== 6) {
      setError("Kode OTP harus 6 digit");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Check OTP in Supabase
      const { data, error: verifyError } = await supabase
        .from("customers")
        .select("*")
        .eq("phone", phone)
        .eq("otp_code", otp)
        .gt("otp_expires", new Date().toISOString())
        .single();

      if (verifyError || !data) {
        throw new Error("Kode OTP salah atau sudah expired");
      }

      // Clear OTP
      await supabase
        .from("customers")
        .update({ otp_code: null, otp_expires: null })
        .eq("phone", phone);

      // Set customer data
      setCustomer(data);
      setOtpVerified(true);

      // Fetch customer orders
      await fetchCustomerOrders(data.id);
    } catch (err: any) {
      setError(err.message || "Verifikasi OTP gagal");
    } finally {
      setLoading(false);
    }
  };

  // Fetch customer orders
  const fetchCustomerOrders = async (customerId: string) => {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      console.error("Failed to fetch orders:", err);
    }
  };

  // Logout
  const logout = () => {
    setCustomer(null);
    setOtpVerified(false);
    setOtpSent(false);
    setPhone("");
    setOtp("");
    setOrders([]);
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // Get tier progress
  const getTierProgress = () => {
    if (!customer) return { current: TIER_CONFIG.bronze, next: TIER_CONFIG.silver, progress: 0 };
    
    const tiers = Object.values(TIER_CONFIG);
    const currentTierIndex = tiers.findIndex(t => t.name.toLowerCase() === customer.tier);
    const nextTierIndex = currentTierIndex + 1;
    
    if (nextTierIndex >= tiers.length) {
      return { current: tiers[currentTierIndex], next: null, progress: 100 };
    }
    
    const current = tiers[currentTierIndex];
    const next = tiers[nextTierIndex];
    const progress = ((customer.points - current.min) / (next.min - current.min)) * 100;
    
    return { current, next, progress: Math.min(progress, 100) };
  };

  // Render login form
  if (!otpVerified) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sabana via-sabana-dark to-sabana-darker flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-24 h-24 bg-white rounded-3xl shadow-xl mx-auto mb-4 flex items-center justify-center">
              <span className="text-4xl font-extrabold text-sabana">S</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white">Sabana</h1>
            <p className="text-white/70 text-sm mt-1">Ayam Goreng & Menu Favorit</p>
          </div>

          {/* Login Card */}
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-1">Masuk ke Akun Anda</h2>
            <p className="text-gray-500 text-sm mb-6">Masukkan nomor HP untuk login via WhatsApp</p>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {!otpSent ? (
              /* Step 1: Enter Phone */
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nomor HP</label>
                  <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus:ring-sabana">
                    <span className="px-3 py-3 bg-gray-50 text-gray-500 text-sm border-r border-gray-200">+62</span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 12);
                        setPhone(val);
                        setError("");
                      }}
                      placeholder="8123456789"
                      className="flex-1 px-3 py-3 focus:outline-none text-lg tracking-wider"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Contoh: 8123456789 (tanpa 0)</p>
                </div>

                <button
                  onClick={sendOTP}
                  disabled={loading || phone.length < 10}
                  className="w-full py-3 rounded-xl font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "#25D366" }}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Mengirim OTP...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                      </svg>
                      Kirim OTP via WhatsApp
                    </span>
                  )}
                </button>
              </div>
            ) : (
              /* Step 2: Enter OTP */
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-green-700 text-sm">
                    ✅ Kode OTP telah dikirim ke <strong>+62{phone}</strong>
                  </p>
                  <p className="text-green-600 text-xs mt-1">Berlaku 5 menit</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Kode OTP</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={otp}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setOtp(val);
                      setError("");
                    }}
                    placeholder="123456"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-sabana"
                  />
                </div>

                <button
                  onClick={verifyOTP}
                  disabled={loading || otp.length !== 6}
                  className="w-full py-3 rounded-xl bg-sabana text-white font-bold hover:bg-sabana-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Verifikasi...
                    </span>
                  ) : (
                    "Verifikasi OTP"
                  )}
                </button>

                <button
                  onClick={() => {
                    setOtpSent(false);
                    setOtp("");
                    setError("");
                  }}
                  className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  Ganti nomor HP
                </button>

                <button
                  onClick={sendOTP}
                  disabled={loading}
                  className="w-full py-2 text-sm text-sabana hover:text-sabana-dark font-medium"
                >
                  Kirim ulang OTP
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="text-center text-white/50 text-xs mt-6">
            Dengan masuk, Anda menyetujui Syarat & Ketentuan
          </p>
        </div>
      </div>
    );
  }

  // Render customer portal
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sabana rounded-xl flex items-center justify-center">
              <span className="text-white font-extrabold text-lg">S</span>
            </div>
            <div>
              <h1 className="font-bold text-gray-800">{customer?.name || "Pelanggan"}</h1>
              <p className="text-xs text-gray-500">+62{customer?.phone}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            Keluar
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-4">
        {/* Tier Card */}
        <div className="bg-gradient-to-r from-sabana to-sabana-dark rounded-2xl p-5 text-white mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-white/70 text-sm">Total Poin</p>
              <p className="text-3xl font-extrabold">{customer?.points || 0}</p>
            </div>
            <div className={`px-3 py-1.5 rounded-full text-sm font-bold ${TIER_CONFIG[customer?.tier || "bronze"].color}`}>
              {TIER_CONFIG[customer?.tier || "bronze"].name}
            </div>
          </div>
          
          {/* Tier Progress */}
          {(() => {
            const tp = getTierProgress();
            return tp.next ? (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>{tp.current.name}</span>
                <span>{tp.next.name}</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-white rounded-full transition-all"
                  style={{ width: `${tp.progress}%` }}
                />
              </div>
              <p className="text-xs text-white/70 mt-1">
                {tp.next.min - (customer?.points || 0)} poin lagi ke {tp.next.name}
              </p>
            </div>
          ) : null;
          })()}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-gray-500 text-sm">Total Transaksi</p>
            <p className="text-2xl font-bold text-gray-800">{orders.length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-gray-500 text-sm">Total Belanja</p>
            <p className="text-2xl font-bold text-gray-800">
              {formatCurrency(orders.reduce((sum, o) => sum + (o.total || 0), 0))}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
          <button
            onClick={() => setActiveTab("profile")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "profile" ? "bg-white shadow text-gray-800" : "text-gray-500"
            }`}
          >
            Profil
          </button>
          <button
            onClick={() => setActiveTab("orders")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "orders" ? "bg-white shadow text-gray-800" : "text-gray-500"
            }`}
          >
            Riwayat ({orders.length})
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "profile" ? (
          <div className="space-y-3">
            {/* Profile Card */}
            <div className="bg-white rounded-xl p-4 border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-3">Informasi Profil</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500 text-sm">Nama</span>
                  <span className="font-medium text-gray-800">{customer?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 text-sm">No. HP</span>
                  <span className="font-medium text-gray-800">+62{customer?.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 text-sm">Member Sejak</span>
                  <span className="font-medium text-gray-800">
                    {now ? new Date(customer?.created_at || "").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "..."}
                  </span>
                </div>
              </div>
            </div>

            {/* Stamps Card */}
            <div className="bg-white rounded-xl p-4 border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-3">Stamp Saya</h3>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-500">{customer?.stamps || 0} / 10 stamp</span>
                    <span className="text-sabana font-medium">Reward Rp 15.000</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-sabana rounded-full transition-all"
                      style={{ width: `${((customer?.stamps || 0) % 10) * 10}%` }}
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Kumpulkan 10 stamp untuk mendapatkan reward Rp 15.000
              </p>
            </div>

            {/* Rewards History */}
            <div className="bg-white rounded-xl p-4 border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-3">Reward Tersedia</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
                  <span className="text-2xl">🎁</span>
                  <div className="flex-1">
                    <p className="font-medium text-green-800">Diskon Rp 15.000</p>
                    <p className="text-xs text-green-600">Berlaku 30 hari</p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${(customer?.stamps || 0) >= 10 ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"}`}>
                    {(customer?.stamps || 0) >= 10 ? "Aktif" : "Terkunci"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.length === 0 ? (
              <div className="bg-white rounded-xl p-8 border border-gray-100 text-center">
                <span className="text-4xl mb-3 block">🛒</span>
                <p className="text-gray-500">Belum ada transaksi</p>
              </div>
            ) : (
              orders.map((order) => (
                <div key={order.id} className="bg-white rounded-xl p-4 border border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">
                      {new Date(order.created_at).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      order.status === "completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    }`}>
                      {order.status === "completed" ? "Selesai" : order.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      {order.payment_method === "cash" ? "Tunai" : "QRIS"}
                    </span>
                    <span className="font-bold text-gray-800">{formatCurrency(order.total)}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-400">
                    ID: {order.id.slice(0, 8)}...
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
