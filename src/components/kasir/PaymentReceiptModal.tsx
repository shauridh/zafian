"use client";

import React, { useState, useMemo, useCallback } from "react";
import clsx from "clsx";
import Numpad from "@/components/ui/Numpad";
import { useCartStore } from "@/stores/cartStore";
import { useShiftStore } from "@/stores/shiftStore";
import { formatRupiah, formatDateTime, generateOrderNumber, SERVICE_MODE_LABELS } from "@/lib/format";
import { QRCodeSVG } from "qrcode.react";
import { findCustomerByPhone, earnPoints, getCustomerTier, type LoyaltyCustomer } from "@/lib/loyalty";
import { getActivePromos, calculateBestDiscount, type PromoResult } from "@/lib/promos";
import { getPrinter, isBluetoothAvailable } from "@/lib/printer";

interface PaymentReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (paymentMethod: string, amountPaid: number, loyaltyCustomer?: LoyaltyCustomer | null) => void;
  saving?: boolean;
  // Receipt props (shown after payment)
  orderNumber?: number;
  paymentResult?: { method: string; amountPaid: number; change: number };
  savedOrderId?: string | null;
}

const ONLINE_FOOD_MODES = ["gofood", "grabfood", "shopeefood"];

export default function PaymentReceiptModal({
  isOpen,
  onClose,
  onComplete,
  saving = false,
  orderNumber = 1,
  paymentResult,
  savedOrderId,
}: PaymentReceiptModalProps) {
  const { getTotal, serviceMode, items } = useCartStore();
  const { cashierName } = useShiftStore();
  const total = getTotal();
  const isOnlineFood = ONLINE_FOOD_MODES.includes(serviceMode);
  const isPaid = !!paymentResult; // Show receipt when payment is done

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

  // Print
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<"idle" | "connecting" | "printing" | "done" | "error">("idle");
  const hasBluetooth = isBluetoothAvailable();

  // Receipt settings
  const [receiptSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("sabana-receipt-settings");
      return saved ? JSON.parse(saved) : { outletName: "SABANA FRIED CHICKEN", outletAddress: "Jl. Contoh No. 123", outletPhone: "0812-xxxx-xxxx", footer: "Terima kasih! Sampai jumpa! 🍗" };
    } catch { return { outletName: "SABANA FRIED CHICKEN", outletAddress: "Jl. Contoh No. 123", outletPhone: "0812-xxxx-xxxx", footer: "Terima kasih! Sampai jumpa! 🍗" }; }
  });

  // Fetch promos when modal opens
  React.useEffect(() => {
    if (!isOpen || isOnlineFood || isPaid) return;
    async function checkPromos() {
      try {
        const promos = await getActivePromos();
        const best = calculateBestDiscount(promos, total);
        setPromoResult(best);
      } catch (err) { /* ignore */ }
    }
    checkPromos();
  }, [isOpen, total, isOnlineFood, isPaid]);

  // Reset on open
  React.useEffect(() => {
    if (isOpen && !isPaid) {
      setLoyaltyCustomer(null);
      setPhoneInput("");
      setLoyaltyError("");
      setCashInput("");
      setPaymentMethod("cash");
    }
  }, [isOpen, isPaid]);

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
    else { setLoyaltyError("Customer tidak ditemukan."); }
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
    [finalTotal]
  );

  const handleComplete = useCallback(() => {
    if (isOnlineFood) { onComplete("estimate", total, loyaltyCustomer); }
    else if (paymentMethod === "qris") { onComplete("qris", finalTotal, loyaltyCustomer); }
    else if (isEnough) { onComplete("cash", amountPaid, loyaltyCustomer); }
  }, [isOnlineFood, paymentMethod, isEnough, finalTotal, total, amountPaid, loyaltyCustomer, onComplete]);

  // Receipt text generation
  const receiptLines = useMemo(() => {
    if (!isPaid || !paymentResult) return [];
    const now = new Date();
    const W = 35;
    const pad = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w);
    const sep = (c: string) => c.repeat(W);
    const method = paymentResult.method === "cash" ? "TUNAI" : paymentResult.method === "estimate" ? "ESTIMASI" : paymentResult.method.toUpperCase();

    return [
      sep("="),
      `  ${pad(receiptSettings.outletName || "SABANA FRIED CHICKEN", W - 4)}`,
      receiptSettings.outletAddress ? `  ${pad(receiptSettings.outletAddress, W - 4)}` : null,
      receiptSettings.outletPhone ? `  Telp: ${pad(receiptSettings.outletPhone, W - 7)}` : null,
      sep("-"),
      `  ${pad(formatDateTime(now), W - 4)}`,
      `  ${pad(savedOrderId ? savedOrderId.slice(0, 28) : generateOrderNumber(orderNumber, serviceMode), W - 4)}`,
      `  Kasir: ${pad(cashierName || "Kasir", W - 9)}`,
      `  ${pad(SERVICE_MODE_LABELS[serviceMode] || serviceMode, W - 4)}`,
      sep("-"),
      ...items.map((item) => {
        const left = `${item.quantity}x ${item.name}`;
        const right = formatRupiah(item.price * item.quantity);
        const lPad = W - right.length - 2;
        return `  ${pad(left, lPad)}${right}`;
      }),
      sep("-"),
      `  Subtotal:${" ".repeat(W - 21)}${formatRupiah(paymentResult.amountPaid - paymentResult.change)}`,
      `  TOTAL:${" ".repeat(W - 19)}${formatRupiah(total)}`,
      `  BAYAR:${" ".repeat(W - 18)}${formatRupiah(paymentResult.amountPaid)}`,
      `  KEMBALIAN:${" ".repeat(W - 20)}${formatRupiah(paymentResult.change)}`,
      sep("-"),
      `  Metode: ${method}`,
      sep("="),
      `  ${pad(receiptSettings.footer || "Terima kasih!", W - 4)}`,
      `  Sabana Fried Chicken`,
    ].filter(Boolean);
  }, [isPaid, paymentResult, orderNumber, serviceMode, items, total, savedOrderId, cashierName, receiptSettings]);

  const handlePrintBT = async () => {
    setPrinting(true);
    setPrintStatus("connecting");
    try {
      const printer = getPrinter();
      const connected = await printer.connect();
      if (!connected) { setPrintStatus("error"); setTimeout(() => setPrintStatus("idle"), 2000); return; }
      setPrintStatus("printing");
      if (!paymentResult) return;
      const success = await printer.printReceipt({
        items: items.map((i) => ({ name: i.name, qty: i.quantity, price: i.price })),
        subtotal: total, total, amountPaid: paymentResult.amountPaid, change: paymentResult.change,
        paymentMethod: paymentResult.method, cashierName: cashierName || "Kasir",
        serviceMode: SERVICE_MODE_LABELS[serviceMode] || serviceMode,
        orderNumber: savedOrderId || `#${orderNumber}`, date: formatDateTime(new Date()),
        outletName: receiptSettings.outletName, outletAddress: receiptSettings.outletAddress, outletPhone: receiptSettings.outletPhone,
      });
      setPrintStatus(success ? "done" : "error");
      setTimeout(() => setPrintStatus("idle"), 2000);
    } catch { setPrintStatus("error"); setTimeout(() => setPrintStatus("idle"), 2000); }
    finally { setPrinting(false); }
  };

  return (
    <div className={clsx("fixed inset-0 z-50 flex", isOpen ? "" : "hidden")}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal container — side by side on tablet+, stacked on phone */}
      <div className="relative z-10 flex w-full h-full p-2 sm:p-3 gap-2">
        {/* === LEFT: Payment === */}
        <div className="flex-1 bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl overflow-hidden flex flex-col min-h-0">
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-200 dark:border-[#333] shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold text-sm sm:text-base text-gray-900 dark:text-gray-100">
                {isPaid ? "✅ Pembayaran Selesai" : isOnlineFood ? "📱 Estimasi Order" : "💳 Pembayaran"}
              </h2>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-400 text-sm">✕</button>
            </div>
            {!isPaid && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                {items.length} item • Total: <span className="text-sabana font-bold">{formatRupiah(total)}</span>
              </p>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-2 sm:p-3 min-h-0">
            {isPaid ? (
              /* === PAID STATE: Show summary === */
              <div className="space-y-2">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center border border-green-200 dark:border-green-800">
                  <p className="text-2xl mb-1">✅</p>
                  <p className="font-bold text-green-700 dark:text-green-300 text-sm">Pembayaran Berhasil</p>
                  <p className="text-xs text-green-600 dark:text-green-400">{formatRupiah(paymentResult!.amountPaid)} — {paymentResult!.method === "cash" ? "TUNAI" : paymentResult!.method.toUpperCase()}</p>
                </div>
                <div className="bg-gray-50 dark:bg-[#222] rounded-xl p-2 text-center">
                  <p className="text-[10px] text-gray-500">Kembalian</p>
                  <p className="font-bold text-sabana">{formatRupiah(paymentResult!.change)}</p>
                </div>
                {/* Quick print buttons */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={handlePrintBT} disabled={printing} className={clsx("py-2 rounded-lg text-[10px] font-semibold transition-all",
                    printStatus === "done" ? "bg-green-500 text-white" : printStatus === "error" ? "bg-red-500 text-white" : "bg-sabana text-white hover:bg-sabana-dark"
                  )}>
                    {printStatus === "done" ? "✅ Tercetak" : printStatus === "connecting" ? "Menyambung..." : printStatus === "printing" ? "Mencetak..." : "🖨️ Print BT"}
                  </button>
                  <button onClick={() => window.print()} className="py-2 rounded-lg text-[10px] font-semibold bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400 hover:bg-gray-200">
                    📄 Print Browser
                  </button>
                </div>
                <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-sabana text-white font-bold text-xs hover:bg-sabana-dark">
                  🛒 Transaksi Baru
                </button>
              </div>
            ) : isOnlineFood ? (
              /* === ONLINE FOOD MODE === */
              <div className="space-y-2">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-2 border border-blue-100 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{serviceMode === "gofood" ? "🛵" : serviceMode === "grabfood" ? "🚚" : "🛒"}</span>
                    <div>
                      <p className="font-semibold text-blue-900 dark:text-blue-200 text-xs">{SERVICE_MODE_LABELS[serviceMode]}</p>
                      <p className="text-[9px] text-blue-600 dark:text-blue-400">Pencatatan Estimasi</p>
                    </div>
                  </div>
                  <input type="text" value={platformOrderId} onChange={(e) => setPlatformOrderId(e.target.value)} placeholder="Order ID Platform (opsional)" className="w-full px-2 py-1.5 rounded-lg border border-blue-200 dark:border-blue-700 dark:bg-[#222] dark:text-gray-100 text-[10px] focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="bg-gray-50 dark:bg-[#222] rounded-xl p-2 flex justify-between">
                  <span className="text-[10px] text-gray-600">Estimasi</span>
                  <span className="text-sm font-bold text-blue-600">{formatRupiah(total)}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 text-[10px] font-semibold">Batal</button>
                  <button onClick={handleComplete} className="flex-1 py-2 rounded-xl bg-blue-600 text-white font-bold text-[10px] hover:bg-blue-700">✅ CATAT</button>
                </div>
              </div>
            ) : (
              /* === CASH/QRIS MODE === */
              <div className="space-y-2">
                {/* Loyalty */}
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-1.5 border border-purple-100 dark:border-purple-800">
                  {loyaltyCustomer ? (
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-white text-[9px] font-bold">{loyaltyCustomer.name?.charAt(0) || "?"}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[10px] text-gray-900 dark:text-gray-200 truncate">{loyaltyCustomer.name} · {getCustomerTier(loyaltyCustomer.points).icon}</p>
                      </div>
                      <button onClick={() => setLoyaltyCustomer(null)} className="text-[9px] text-gray-400">✕</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input type="tel" value={phoneInput} onChange={(e) => { setPhoneInput(e.target.value); setLoyaltyError(""); }} onKeyDown={(e) => e.key === "Enter" && handleLoyaltySearch()} placeholder="No. HP (poin)" className="flex-1 px-2 py-1 rounded border border-purple-200 dark:border-purple-700 text-[9px] bg-white dark:bg-[#222] dark:text-gray-100 focus:ring-1 focus:ring-purple-500" />
                      <button onClick={handleLoyaltySearch} disabled={loyaltySearching} className="px-2 py-1 bg-purple-600 text-white rounded text-[9px] font-semibold">{loyaltySearching ? "..." : "Cari"}</button>
                    </div>
                  )}
                  {loyaltyError && <p className="text-[8px] text-red-500 mt-0.5">{loyaltyError}</p>}
                </div>

                {/* Payment method */}
                <div className="flex gap-1.5">
                  <button onClick={() => setPaymentMethod("cash")} className={clsx("flex-1 py-2 rounded-xl font-semibold text-xs border-2 transition-all", paymentMethod === "cash" ? "bg-sabana text-white border-sabana shadow" : "bg-white dark:bg-[#222] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#444]")}>💵 TUNAI</button>
                  <button onClick={() => setPaymentMethod("qris")} className={clsx("flex-1 py-2 rounded-xl font-semibold text-xs border-2 transition-all", paymentMethod === "qris" ? "bg-blue-600 text-white border-blue-600 shadow" : "bg-white dark:bg-[#222] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#444]")}>📱 QRIS</button>
                </div>

                {paymentMethod === "cash" ? (
                  <>
                    {promoResult && (
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-gray-500 line-through">{formatRupiah(total)}</span>
                        <span className="text-green-600 font-semibold">-{formatRupiah(promoResult.discount_amount)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">Total</span>
                      <span className="text-sm font-bold text-sabana">{formatRupiah(finalTotal)}</span>
                    </div>
                    <div className="bg-gray-50 dark:bg-[#222] rounded-xl p-2 text-center border border-gray-200 dark:border-[#444]">
                      <span className="text-lg font-mono font-bold text-gray-900 dark:text-gray-100">Rp {amountPaid > 0 ? amountPaid.toLocaleString("id-ID") : "0"}</span>
                    </div>
                    <Numpad value={cashInput} onChange={setCashInput} showQuickAmounts quickAmounts={quickAmounts} />
                    <div className={clsx("p-1.5 rounded-xl text-center", change > 0 ? "bg-green-50 dark:bg-green-900/20 border border-green-200" : "bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-[#444]")}>
                      <p className="text-[9px] text-gray-500">Kembalian</p>
                      <p className={clsx("text-sm font-bold", change > 0 ? "text-green-600" : "text-gray-400")}>{formatRupiah(change)}</p>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-1">
                    <QRCodeSVG value={`https://qris.sabana.id/pay?amount=${finalTotal}&order=${Date.now()}`} size={120} level="H" includeMargin={false} />
                    <p className="text-[9px] text-gray-500 mt-1">Total: <span className="font-bold text-blue-600">{formatRupiah(finalTotal)}</span></p>
                    <p className="text-[8px] text-gray-400">⏱️ QR berlaku 15 menit</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-1.5 pt-1">
                  <button onClick={onClose} className="px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 text-[10px] font-semibold">Batal</button>
                  <button onClick={handleComplete} disabled={!isEnough || saving} className={clsx("flex-1 py-2 rounded-xl font-bold text-xs transition-all", saving ? "bg-gray-400 text-white" : isEnough ? "bg-green-600 text-white shadow hover:bg-green-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}>
                    {saving ? "Menyimpan..." : "✅ BAYAR"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* === RIGHT: Receipt === */}
        <div className="hidden sm:flex flex-col w-[280px] lg:w-[320px] bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl overflow-hidden min-h-0">
          <div className="px-3 py-2 border-b border-gray-200 dark:border-[#333] shrink-0">
            <h3 className="font-heading font-bold text-xs text-gray-900 dark:text-gray-100">🧾 Struk</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            {isPaid ? (
              <pre className="text-[9px] leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre font-mono">
                {receiptLines.join("\n")}
              </pre>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <span className="text-2xl mb-1">🧾</span>
                <p className="text-[10px]">Struk muncul setelah pembayaran</p>
              </div>
            )}
          </div>
          {isPaid && (
            <div className="px-2 pb-2 shrink-0">
              <div className="grid grid-cols-2 gap-1">
                <button onClick={handlePrintBT} disabled={printing} className={clsx("py-1.5 rounded-lg text-[9px] font-semibold",
                  printStatus === "done" ? "bg-green-500 text-white" : "bg-sabana text-white"
                )}>
                  {printStatus === "done" ? "✅" : "🖨️"} Print BT
                </button>
                <button onClick={() => window.print()} className="py-1.5 rounded-lg text-[9px] font-semibold bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400">📄 Browser</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
