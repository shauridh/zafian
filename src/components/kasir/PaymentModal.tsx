"use client";

import React, { useState, useMemo, useCallback } from "react";
import clsx from "clsx";
import Modal from "@/components/ui/Modal";
import Numpad from "@/components/ui/Numpad";
import { useCartStore } from "@/stores/cartStore";
import { formatRupiah, SERVICE_MODE_LABELS } from "@/lib/format";
import { QRCodeSVG } from "qrcode.react";
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

  // Promo
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);

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

  React.useEffect(() => {
    if (isOpen) {
      setLoyaltyCustomer(null);
      setPhoneInput("");
      setLoyaltyError("");
    }
  }, [isOpen]);

  const finalTotal = total - (promoResult?.discount_amount || 0);
  const amountPaid = parseInt(cashInput) || 0;
  const change = paymentMethod === "cash" ? Math.max(0, amountPaid - finalTotal) : 0;
  const isEnough = isOnlineFood || paymentMethod === "qris" || amountPaid >= finalTotal;

  const handleLoyaltySearch = async () => {
    if (!phoneInput || phoneInput.length < 8) { setLoyaltyError("Masukkan nomor HP yang valid"); return; }
    setLoyaltySearching(true);
    setLoyaltyError("");
    const customer = await findCustomerByPhone(phoneInput);
    if (customer) { setLoyaltyCustomer(customer); setLoyaltyError(""); }
    else { setLoyaltyError("Customer tidak ditemukan. Ketik nama untuk daftar baru."); }
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
    if (isOnlineFood) { onComplete("estimate", total, loyaltyCustomer); }
    else if (paymentMethod === "qris") { onComplete("qris", finalTotal, loyaltyCustomer); }
    else if (isEnough) { onComplete("cash", amountPaid, loyaltyCustomer); }
  }, [isOnlineFood, paymentMethod, isEnough, finalTotal, total, amountPaid, loyaltyCustomer, onComplete]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" showClose={false}>
      <div className="p-3 sm:p-4">
        {/* Header */}
        <div className="text-center mb-3 sm:mb-4">
          <h2 className="text-lg sm:text-xl font-heading font-bold text-gray-900 dark:text-gray-100 mb-0.5">
            {isOnlineFood ? "📱 Estimasi Order" : "💳 Pembayaran"}
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            {items.length} item • Total: <span className="text-sabana font-bold">{formatRupiah(total)}</span>
          </p>
          {isOnlineFood && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-full text-[10px] sm:text-xs font-medium">
              <span>ℹ️</span>
              <span>Uang masuk via platform — hanya pencatatan estimasi</span>
            </div>
          )}
        </div>

        {isOnlineFood ? (
          /* ===== ONLINE FOOD MODE ===== */
          <div className="space-y-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-100 dark:border-blue-800">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{serviceMode === "gofood" ? "🛵" : serviceMode === "grabfood" ? "🚚" : "🛒"}</span>
                <div>
                  <p className="font-semibold text-blue-900 dark:text-blue-200 text-sm">{SERVICE_MODE_LABELS[serviceMode]}</p>
                  <p className="text-[10px] text-blue-600 dark:text-blue-400">Pencatatan Estimasi</p>
                </div>
              </div>
              <input type="text" value={platformOrderId} onChange={(e) => setPlatformOrderId(e.target.value)} placeholder="Order ID Platform (opsional)" className="w-full px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-700 dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs" />
            </div>
            <div className="bg-gray-50 dark:bg-[#222] rounded-xl p-3 flex justify-between items-center">
              <span className="text-xs text-gray-600 dark:text-gray-400">Estimasi Pendapatan</span>
              <span className="text-base font-bold text-blue-600">{formatRupiah(total)}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2.5 rounded-xl border-2 border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 font-semibold text-sm active:scale-95">❌ Batal</button>
              <button onClick={handleComplete} className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-blue-600 text-white shadow-lg hover:bg-blue-700 active:scale-95">✅ CATAT</button>
            </div>
          </div>
        ) : (
          /* ===== CASH / QRIS MODE ===== */
          <>
            {/* Promo Badge */}
            {promoResult && (
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-2 mb-2 border border-green-200 dark:border-green-800 flex items-center gap-2">
                <span className="text-sm">🏷️</span>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-green-800 dark:text-green-200">{promoResult.promo.name}</p>
                  <p className="text-[10px] text-green-600 dark:text-green-400">{promoResult.description}</p>
                </div>
              </div>
            )}

            {/* Loyalty */}
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-2 mb-2 border border-purple-100 dark:border-purple-800">
              {loyaltyCustomer ? (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold text-xs">{loyaltyCustomer.name?.charAt(0) || "?"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-gray-900 dark:text-gray-200 text-xs truncate">{loyaltyCustomer.name || "Customer"}</p>
                      <span className="text-[9px] text-purple-600 dark:text-purple-300">{getCustomerTier(loyaltyCustomer.points).icon} {getCustomerTier(loyaltyCustomer.points).label}</span>
                    </div>
                    <p className="text-[9px] text-gray-500 dark:text-gray-400">📱 {loyaltyCustomer.phone} · {loyaltyCustomer.points} poin</p>
                  </div>
                  <button onClick={() => setLoyaltyCustomer(null)} className="text-[10px] text-gray-400 hover:text-gray-600">✕</button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input type="tel" value={phoneInput} onChange={(e) => { setPhoneInput(e.target.value); setLoyaltyError(""); }} onKeyDown={(e) => e.key === "Enter" && handleLoyaltySearch()} placeholder="No. HP (untuk poin)" className="flex-1 px-2 py-1.5 rounded-lg border border-purple-200 dark:border-purple-700 text-[10px] sm:text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white dark:bg-[#222] dark:text-gray-100" />
                  <button onClick={handleLoyaltySearch} disabled={loyaltySearching} className="px-2.5 py-1.5 bg-purple-600 text-white rounded-lg text-[10px] font-semibold hover:bg-purple-700 disabled:opacity-50">{loyaltySearching ? "..." : "Cari"}</button>
                </div>
              )}
              {loyaltyError && <p className="text-[9px] text-red-500 mt-1">{loyaltyError}</p>}
            </div>

            {/* Payment Method Toggle */}
            <div className="flex gap-2 mb-3">
              <button onClick={() => setPaymentMethod("cash")} className={clsx("flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer border-2", paymentMethod === "cash" ? "bg-sabana text-white border-sabana shadow-lg" : "bg-white dark:bg-[#222] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#444]")}>💵 TUNAI</button>
              <button onClick={() => setPaymentMethod("qris")} className={clsx("flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer border-2", paymentMethod === "qris" ? "bg-blue-600 text-white border-blue-600 shadow-lg" : "bg-white dark:bg-[#222] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#444]")}>📱 QRIS</button>
            </div>

            {paymentMethod === "cash" ? (
              <>
                {promoResult && (
                  <div className="flex items-center justify-between mb-1 text-xs">
                    <span className="text-gray-500 line-through">{formatRupiah(total)}</span>
                    <span className="text-success font-semibold">-{formatRupiah(promoResult.discount_amount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Total{promoResult ? " (diskon)" : ""}</label>
                  <span className="text-base font-bold text-sabana">{formatRupiah(finalTotal)}</span>
                </div>
                <div className="bg-gray-50 dark:bg-[#222] rounded-xl p-2.5 text-center border border-gray-200 dark:border-[#444] mb-2">
                  <span className="text-xl sm:text-2xl font-mono font-bold text-gray-900 dark:text-gray-100">Rp {amountPaid > 0 ? amountPaid.toLocaleString("id-ID") : "0"}</span>
                </div>

                <Numpad value={cashInput} onChange={setCashInput} showQuickAmounts quickAmounts={quickAmounts} />

                <div className={clsx("mt-2 p-2.5 rounded-xl text-center", change > 0 ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" : "bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-[#444]")}>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">Kembalian</p>
                  <p className={clsx("text-lg font-heading font-bold", change > 0 ? "text-success" : "text-gray-400")}>{formatRupiah(change)}</p>
                </div>
              </>
            ) : (
              <div className="py-2">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-2 mb-3 border border-blue-100 dark:border-blue-800 flex items-center gap-2">
                  <span className="text-sm">📱</span>
                  <div>
                    <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">Dynamic QRIS</p>
                    <p className="text-[9px] text-blue-600 dark:text-blue-400">Scan dengan GoPay, OVO, Dana, ShopeePay</p>
                  </div>
                </div>
                <div className="flex justify-center">
                  <QRCodeSVG value={`https://qris.sabana.id/pay?amount=${finalTotal}&order=${Date.now()}`} size={160} level="H" includeMargin={false} bgColor="#FFFFFF" fgColor="#000000" />
                </div>
                <div className="text-center mt-2">
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="text-lg font-bold text-blue-600">{formatRupiah(finalTotal)}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">⏱️ QR berlaku 15 menit</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 mt-3">
              <button onClick={onClose} className="px-4 py-2.5 rounded-xl border-2 border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 font-semibold text-sm active:scale-95">❌ Batal</button>
              <button onClick={handleComplete} disabled={!isEnough || saving} className={clsx("flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95", saving ? "bg-gray-400 text-white cursor-wait" : isEnough ? "bg-success text-white shadow-lg hover:bg-green-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}>
                {saving ? (
                  <span className="flex items-center justify-center gap-2"><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Menyimpan...</span>
                ) : "✅ BAYAR"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
