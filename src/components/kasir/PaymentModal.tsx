"use client";

import React, { useState, useMemo, useCallback } from "react";
import clsx from "clsx";
import Modal from "@/components/ui/Modal";
import Numpad from "@/components/ui/Numpad";
import { useCartStore } from "@/stores/cartStore";
import { formatRupiah, SERVICE_MODE_LABELS } from "@/lib/format";
import QRCode from "qrcode.react";
import { findCustomerByPhone, earnPoints, getCustomerTier, type LoyaltyCustomer } from "@/lib/loyalty";
import { getActivePromos, calculateBestDiscount, type PromoResult } from "@/lib/promos";

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (paymentMethod: string, amountPaid: number, loyaltyCustomer?: LoyaltyCustomer | null) => void;
  saving?: boolean;
}

const ONLINE_FOOD_MODES = ["gofood", "grabfood", "shopeefood"];

export default function PaymentModal({
  isOpen,
  onClose,
  onComplete,
  saving = false,
}: PaymentModalProps) {
  const { getTotal, serviceMode, items } = useCartStore();
  const total = getTotal();
  const isOnlineFood = ONLINE_FOOD_MODES.includes(serviceMode);

  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qris">("cash");
  const [cashInput, setCashInput] = useState("");
  const [platformOrderId, setPlatformOrderId] = useState("");

  // Loyalty
  const [phoneInput, setPhoneInput] = useState("");
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<LoyaltyCustomer | null>(null);
  const [loyaltySearching, setLoyaltySearching] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState("");
  const [pointsEarned, setPointsEarned] = useState<number | null>(null);

  // Promo
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);

  // Fetch promos when modal opens
  React.useEffect(() => {
    if (!isOpen || isOnlineFood) return;
    async function checkPromos() {
      setPromoLoading(true);
      try {
        const promos = await getActivePromos();
        const best = calculateBestDiscount(promos, total);
        setPromoResult(best);
      } catch (err) { /* ignore */ }
      setPromoLoading(false);
    }
    checkPromos();
  }, [isOpen, total, isOnlineFood]);

  // Reset state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setLoyaltyCustomer(null);
      setPhoneInput("");
      setLoyaltyError("");
      setPointsEarned(null);
    }
  }, [isOpen]);

  const finalTotal = total - (promoResult?.discount_amount || 0);
  const amountPaid = parseInt(cashInput) || 0;
  const change = paymentMethod === "cash" ? Math.max(0, amountPaid - finalTotal) : 0;
  const isEnough = isOnlineFood || paymentMethod === "qris" || amountPaid >= finalTotal;

  // Loyalty search
  const handleLoyaltySearch = async () => {
    if (!phoneInput || phoneInput.length < 8) { setLoyaltyError("Masukkan nomor HP yang valid"); return; }
    setLoyaltySearching(true);
    setLoyaltyError("");
    const customer = await findCustomerByPhone(phoneInput);
    if (customer) {
      setLoyaltyCustomer(customer);
      setLoyaltyError("");
    } else {
      setLoyaltyError("Customer tidak ditemukan. Ketik nama untuk daftar baru.");
    }
    setLoyaltySearching(false);
  };

  const quickAmounts = useMemo(
    () => [
      { label: "UANG PAS", value: finalTotal },
      { label: "100K", value: 100000 },
      { label: "150K", value: 150000 },
      { label: "200K", value: 200000 },
      { label: "500K", value: 500000 },
    ],
    [total]
  );

  const handleComplete = useCallback(() => {
    if (isOnlineFood) {
      onComplete("estimate", total, loyaltyCustomer);
    } else if (paymentMethod === "qris") {
      onComplete("qris", finalTotal, loyaltyCustomer);
    } else if (isEnough) {
      onComplete("cash", amountPaid, loyaltyCustomer);
    }
  }, [isOnlineFood, paymentMethod, isEnough, finalTotal, total, amountPaid, loyaltyCustomer, onComplete]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" showClose={false}>
      <div className="p-6">
        {/* Header */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-heading font-bold text-gray-900 mb-1">
            {isOnlineFood ? "📱 Estimasi Order" : "💳 Pembayaran"}
          </h2>
          <p className="text-gray-500">
            {items.length} item • Total:{" "}
            <span className="text-sabana font-bold">{formatRupiah(total)}</span>
          </p>
          {isOnlineFood && (
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
              <span>ℹ️</span>
              <span>Uang masuk via platform — hanya pencatatan estimasi</span>
            </div>
          )}
        </div>

        {isOnlineFood ? (
          /* ===== ONLINE FOOD MODE ===== */
          <div className="space-y-4">
            {/* Platform info */}
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">
                  {serviceMode === "gofood" ? "🛵" : serviceMode === "grabfood" ? "🚚" : "🛒"}
                </span>
                <div>
                  <p className="font-semibold text-blue-900">
                    {SERVICE_MODE_LABELS[serviceMode]}
                  </p>
                  <p className="text-sm text-blue-600">Pencatatan Estimasi</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Order ID Platform (opsional)
                </label>
                <input
                  type="text"
                  value={platformOrderId}
                  onChange={(e) => setPlatformOrderId(e.target.value)}
                  placeholder="Contoh: GFO-123456"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 
                             focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>

            {/* Summary */}
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Estimasi Pendapatan</span>
                <span className="text-xl font-bold text-blue-600">
                  {formatRupiah(total)}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Stok akan dikurangi otomatis
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-6 py-4 rounded-xl border-2 border-gray-200 text-gray-600 
                           font-semibold hover:bg-gray-50 active:scale-95 transition-all"
              >
                ❌ Batal
              </button>
              <button
                onClick={handleComplete}
                className="flex-1 py-4 rounded-xl font-bold text-lg transition-all active:scale-95
                           bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700"
              >
                ✅ CATAT PESANAN
              </button>
            </div>
          </div>
        ) : (
          /* ===== CASH / QRIS MODE ===== */
          <>
            {/* Promo Badge */}
            {promoResult && (
              <div className="bg-green-50 rounded-xl p-3 mb-4 border border-green-200 flex items-center gap-2">
                <span className="text-lg">🏷️</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-green-800">{promoResult.promo.name}</p>
                  <p className="text-xs text-green-600">{promoResult.description}</p>
                </div>
              </div>
            )}

            {/* Loyalty Customer Lookup */}
            <div className="bg-purple-50 rounded-xl p-3 mb-4 border border-purple-100">
              {loyaltyCustomer ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold text-sm">
                    {loyaltyCustomer.name?.charAt(0) || "?"}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-sm">{loyaltyCustomer.name || "Customer"}</p>
                      <span className="text-xs text-purple-600">{getCustomerTier(loyaltyCustomer.points).icon} {getCustomerTier(loyaltyCustomer.points).label}</span>
                    </div>
                    <p className="text-xs text-gray-500">📱 {loyaltyCustomer.phone} · {loyaltyCustomer.points} poin · {loyaltyCustomer.stamps % 10}/10 stamp</p>
                  </div>
                  <button onClick={() => setLoyaltyCustomer(null)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input type="tel" value={phoneInput} onChange={(e) => { setPhoneInput(e.target.value); setLoyaltyError(""); }} onKeyDown={(e) => e.key === "Enter" && handleLoyaltySearch()} placeholder="No. HP customer (untuk poin)" className="flex-1 px-3 py-2 rounded-lg border border-purple-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white" />
                  <button onClick={handleLoyaltySearch} disabled={loyaltySearching} className="px-3 py-2 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700 disabled:opacity-50">
                    {loyaltySearching ? "..." : "Cari"}
                  </button>
                </div>
              )}
              {loyaltyError && <p className="text-xs text-red-500 mt-1">{loyaltyError}</p>}
            </div>

            {/* Payment Method Toggle */}
            <div className="flex gap-3 mb-6">
              <button
                onClick={() => setPaymentMethod("cash")}
                className={clsx(
                  "flex-1 py-4 rounded-xl font-semibold text-lg transition-all duration-200 cursor-pointer border-2",
                  paymentMethod === "cash"
                    ? "bg-sabana text-white border-sabana shadow-lg"
                    : "bg-white text-gray-600 border-gray-200 hover:border-sabana"
                )}
              >
                💵 TUNAI
              </button>
              <button
                onClick={() => setPaymentMethod("qris")}
                className={clsx(
                  "flex-1 py-4 rounded-xl font-semibold text-lg transition-all duration-200 cursor-pointer border-2",
                  paymentMethod === "qris"
                    ? "bg-blue-600 text-white border-blue-600 shadow-lg"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-600"
                )}
              >
                📱 QRIS
              </button>
            </div>

            {paymentMethod === "cash" ? (
              <>
                {/* Cash Payment */}
                <div className="mb-4">
                  {/* Total after promo */}
                  {promoResult && (
                    <div className="flex items-center justify-between mb-2 text-sm">
                      <span className="text-gray-500 line-through">{formatRupiah(total)}</span>
                      <span className="text-success font-semibold">-{formatRupiah(promoResult.discount_amount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-600">
                      Total{promoResult ? " (sudah diskon)" : ""}
                    </label>
                    <span className="text-lg font-bold text-sabana">{formatRupiah(finalTotal)}</span>
                  </div>
                  <label className="block text-sm font-medium text-gray-600 mb-2">
                    Jumlah Bayar
                  </label>
                  <div className="bg-gray-50 rounded-xl p-4 text-center border border-gray-200">
                    <span className="text-3xl font-mono font-bold text-gray-900">
                      Rp {amountPaid > 0 ? amountPaid.toLocaleString("id-ID") : "0"}
                    </span>
                  </div>
                </div>

                {/* Numpad — quick amounts are now internal to Numpad */}
                <Numpad
                  value={cashInput}
                  onChange={setCashInput}
                  showQuickAmounts
                  quickAmounts={quickAmounts}
                />

                {/* Change Display */}
                <div
                  className={clsx(
                    "mt-4 p-4 rounded-xl text-center",
                    change > 0
                      ? "bg-green-50 border border-green-200"
                      : "bg-gray-50 border border-gray-200"
                  )}
                >
                  <p className="text-sm text-gray-500">Kembalian</p>
                  <p
                    className={clsx(
                      "text-2xl font-heading font-bold",
                      change > 0 ? "text-success" : "text-gray-400"
                    )}
                  >
                    {formatRupiah(change)}
                  </p>
                </div>
              </>
            ) : (
              /* QRIS Payment — Dynamic QR */
              <div className="py-4">
                <div className="bg-blue-50 rounded-xl p-3 mb-4 border border-blue-100 flex items-center gap-2">
                  <span className="text-lg">📱</span>
                  <div>
                    <p className="text-sm font-semibold text-blue-900">Dynamic QRIS</p>
                    <p className="text-xs text-blue-600">Scan dengan GoPay, OVO, Dana, ShopeePay, LinkAja, atau Mobile Banking</p>
                  </div>
                </div>
                <div className="flex justify-center">
                  <QRCode
                    value={`https://qris.sabana.id/pay?amount=${finalTotal}&order=${Date.now()}`}
                    size={200}
                    level="H"
                    includeMargin={false}
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                  />
                </div>
                <div className="text-center mt-3">
                  <p className="text-sm text-gray-500">Total Pembayaran</p>
                  <p className="text-2xl font-bold text-blue-600">{formatRupiah(finalTotal)}</p>
                  <p className="text-[10px] text-gray-400 mt-1">⏱️ QR berlaku selama 15 menit</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={onClose}
                className="px-6 py-4 rounded-xl border-2 border-gray-200 text-gray-600 
                           font-semibold hover:bg-gray-50 active:scale-95 transition-all"
              >
                ❌ Batal
              </button>
              <button
                onClick={handleComplete}
                disabled={!isEnough || saving}
                className={clsx(
                  "flex-1 py-4 rounded-xl font-bold text-lg transition-all active:scale-95",
                  saving
                    ? "bg-gray-400 text-white cursor-wait"
                    : isEnough
                    ? "bg-success text-white shadow-lg shadow-success/30 hover:bg-green-700"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                )}
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Menyimpan...
                  </span>
                ) : (
                  "✅ SELESAI BAYAR"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
