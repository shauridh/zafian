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

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (paymentMethod: string, amountPaid: number, loyaltyCustomer?: LoyaltyCustomer | null) => void;
  saving?: boolean;
  orderNumber?: number;
  paymentResult?: { method: string; amountPaid: number; change: number };
  savedOrderId?: string | null;
}

const ONLINE_FOOD = ["gofood", "grabfood", "shopeefood"];

export default function PaymentReceiptModal({ isOpen, onClose, onComplete, saving, orderNumber = 1, paymentResult, savedOrderId }: Props) {
  const { getTotal, serviceMode, items } = useCartStore();
  const { cashierName } = useShiftStore();
  const total = getTotal();
  const isOnlineFood = ONLINE_FOOD.includes(serviceMode);
  const isPaid = !!paymentResult;

  const [pm, setPm] = useState<"cash" | "qris">("cash");
  const [cashIn, setCashIn] = useState("");
  const [platId, setPlatId] = useState("");
  const [phone, setPhone] = useState("");
  const [loyal, setLoyal] = useState<LoyaltyCustomer | null>(null);
  const [loyalErr, setLoyalErr] = useState("");
  const [loyalLoading, setLoyalLoading] = useState(false);
  const [promo, setPromo] = useState<PromoResult | null>(null);
  const [printSt, setPrintSt] = useState<"idle" | "ok" | "err">("idle");
  const [printing, setPrinting] = useState(false);
  const hasBT = isBluetoothAvailable();

  const [rSettings] = useState(() => {
    try { const s = localStorage.getItem("sabana-receipt-settings"); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });

  React.useEffect(() => {
    if (!isOpen || isOnlineFood || isPaid) return;
    (async () => { try { const p = await getActivePromos(); setPromo(calculateBestDiscount(p, total)); } catch {} })();
  }, [isOpen, total, isOnlineFood, isPaid]);

  React.useEffect(() => { if (isOpen && !isPaid) { setLoyal(null); setPhone(""); setLoyalErr(""); setCashIn(""); setPm("cash"); } }, [isOpen, isPaid]);

  const fTotal = total - (promo?.discount_amount || 0);
  const paid = parseInt(cashIn) || 0;
  const change = pm === "cash" ? Math.max(0, paid - fTotal) : 0;
  const enough = isOnlineFood || pm === "qris" || paid >= fTotal;

  const qAmts = useMemo(() => [
    { label: "UANG PAS", value: fTotal },
    { label: "100K", value: 100000 }, { label: "150K", value: 150000 },
    { label: "200K", value: 200000 }, { label: "500K", value: 500000 },
  ], [fTotal]);

  const doComplete = useCallback(() => {
    if (isOnlineFood) onComplete("estimate", total, loyal);
    else if (pm === "qris") onComplete("qris", fTotal, loyal);
    else if (enough) onComplete("cash", paid, loyal);
  }, [isOnlineFood, pm, enough, fTotal, total, paid, loyal, onComplete]);

  const doLoyalty = async () => {
    if (!phone || phone.length < 8) { setLoyalErr("Nomor HP tidak valid"); return; }
    setLoyalLoading(true); setLoyalErr("");
    const c = await findCustomerByPhone(phone);
    if (c) setLoyal(c); else setLoyalErr("Tidak ditemukan");
    setLoyalLoading(false);
  };

  const doPrintBT = async () => {
    setPrinting(true); setPrintSt("idle");
    try {
      const p = getPrinter();
      if (!(await p.connect())) { setPrintSt("err"); setTimeout(() => setPrintSt("idle"), 2000); return; }
      if (!paymentResult) return;
      const ok = await p.printReceipt({
        items: items.map(i => ({ name: i.name, qty: i.quantity, price: i.price })),
        subtotal: total, total, amountPaid: paymentResult.amountPaid, change: paymentResult.change,
        paymentMethod: paymentResult.method, cashierName: cashierName || "Kasir",
        serviceMode: SERVICE_MODE_LABELS[serviceMode] || serviceMode,
        orderNumber: savedOrderId || `#${orderNumber}`, date: formatDateTime(new Date()),
        outletName: rSettings.outletName, outletAddress: rSettings.outletAddress, outletPhone: rSettings.outletPhone,
      });
      setPrintSt(ok ? "ok" : "err");
    } catch { setPrintSt("err"); }
    setTimeout(() => setPrintSt("idle"), 2000);
    setPrinting(false);
  };

  // Receipt text
  const rLines = useMemo(() => {
    if (!isPaid || !paymentResult) return [];
    const W = 35, now = new Date();
    const p = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + "\u2026" : s.padEnd(w);
    const sep = (c: string) => c.repeat(W);
    const m = paymentResult.method === "cash" ? "TUNAI" : paymentResult.method === "estimate" ? "ESTIMASI" : paymentResult.method.toUpperCase();
    return [
      sep("="), `  ${p(rSettings.outletName || "SABANA FRIED CHICKEN", W - 4)}`,
      rSettings.outletAddress ? `  ${p(rSettings.outletAddress, W - 4)}` : null,
      rSettings.outletPhone ? `  Telp: ${p(rSettings.outletPhone, W - 7)}` : null,
      sep("-"), `  ${p(formatDateTime(now), W - 4)}`, `  ${p(savedOrderId?.slice(0, 28) || generateOrderNumber(orderNumber, serviceMode), W - 4)}`,
      `  Kasir: ${p(cashierName || "Kasir", W - 9)}`, `  ${p(SERVICE_MODE_LABELS[serviceMode] || serviceMode, W - 4)}`,
      sep("-"),
      ...items.map(i => `  ${p(`${i.quantity}x ${i.name}`, W - formatRupiah(i.price * i.quantity).length - 2)}${formatRupiah(i.price * i.quantity)}`),
      sep("-"), `  Subtotal:${" ".repeat(W - 21)}${formatRupiah(total)}`,
      `  TOTAL:${" ".repeat(W - 19)}${formatRupiah(total)}`,
      `  BAYAR:${" ".repeat(W - 18)}${formatRupiah(paymentResult.amountPaid)}`,
      `  KEMBALIAN:${" ".repeat(W - 20)}${formatRupiah(paymentResult.change)}`,
      sep("-"), `  Metode: ${m}`, sep("="),
      `  ${p(rSettings.footer || "Terima kasih!", W - 4)}`, `  Sabana Fried Chicken`,
    ].filter(Boolean);
  }, [isPaid, paymentResult]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-[900px] h-[85vh] max-h-[600px] bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl overflow-hidden">

        {/* === LEFT: Payment === */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-200 dark:border-[#333] shrink-0 flex items-center justify-between">
            <div>
              <h2 className="font-heading font-bold text-sm text-gray-900 dark:text-gray-100">
                {isPaid ? "✅ Pembayaran Selesai" : isOnlineFood ? "📱 Estimasi" : "💳 Pembayaran"}
              </h2>
              {!isPaid && <p className="text-[10px] text-gray-500">{items.length} item · Total: <span className="text-sabana font-bold">{formatRupiah(total)}</span></p>}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-400 text-xs">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 min-h-0">
            {isPaid ? (
              /* === PAID === */
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-3xl">✅</div>
                <div className="text-center">
                  <p className="font-bold text-green-700 dark:text-green-300">Pembayaran Berhasil</p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatRupiah(paymentResult!.amountPaid)} · {paymentResult!.method === "cash" ? "TUNAI" : paymentResult!.method.toUpperCase()}</p>
                  <p className="text-xs text-green-600 font-semibold mt-0.5">Kembalian: {formatRupiah(paymentResult!.change)}</p>
                </div>
                <div className="flex gap-2 w-full max-w-[200px]">
                  <button onClick={doPrintBT} disabled={printing} className={clsx("flex-1 py-2 rounded-lg text-[10px] font-bold transition-all",
                    printSt === "ok" ? "bg-green-500 text-white" : printSt === "err" ? "bg-red-500 text-white" : "bg-sabana text-white"
                  )}>{printSt === "ok" ? "✅ Tercetak" : printing ? "..." : "🖨️ Print"}</button>
                  <button onClick={() => window.print()} className="flex-1 py-2 rounded-lg text-[10px] font-bold bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400">📄 Browser</button>
                </div>
                <button onClick={onClose} className="w-full max-w-[200px] py-2.5 rounded-xl bg-sabana text-white font-bold text-xs hover:bg-sabana-dark shadow-lg shadow-sabana/30">
                  🛒 Transaksi Baru
                </button>
              </div>
            ) : isOnlineFood ? (
              /* === ONLINE FOOD === */
              <div className="space-y-2.5">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-2.5 border border-blue-100 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xl">{serviceMode === "gofood" ? "🛵" : serviceMode === "grabfood" ? "🚚" : "🛒"}</span>
                    <div><p className="font-semibold text-blue-900 dark:text-blue-200 text-xs">{SERVICE_MODE_LABELS[serviceMode]}</p><p className="text-[9px] text-blue-500">Pencatatan Estimasi</p></div>
                  </div>
                  <input type="text" value={platId} onChange={e => setPlatId(e.target.value)} placeholder="Order ID Platform (opsional)" className="w-full px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-700 dark:bg-[#222] text-[10px]" />
                </div>
                <div className="flex justify-between items-center bg-gray-50 dark:bg-[#222] rounded-xl p-2">
                  <span className="text-[10px] text-gray-500">Estimasi Pendapatan</span><span className="text-sm font-bold text-blue-600">{formatRupiah(total)}</span>
                </div>
                <div className="flex gap-2"><button onClick={onClose} className="flex-1 py-2 rounded-xl border text-gray-600 dark:text-gray-400 text-[10px] font-semibold">Batal</button>
                  <button onClick={doComplete} className="flex-1 py-2 rounded-xl bg-blue-600 text-white font-bold text-[10px]">✅ CATAT</button></div>
              </div>
            ) : (
              /* === CASH/QRIS === */
              <div className="space-y-2">
                {/* Loyalty */}
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-1.5 border border-purple-100 dark:border-purple-800">
                  {loyal ? (
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-white text-[9px] font-bold">{loyal.name?.charAt(0) || "?"}</div>
                      <span className="flex-1 text-[10px] font-semibold truncate">{loyal.name} · {getCustomerTier(loyal.points).icon}</span>
                      <button onClick={() => setLoyal(null)} className="text-[9px] text-gray-400">✕</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input type="tel" value={phone} onChange={e => { setPhone(e.target.value); setLoyalErr(""); }} onKeyDown={e => e.key === "Enter" && doLoyalty()} placeholder="No. HP (poin)" className="flex-1 px-2 py-1 rounded border border-purple-200 dark:border-purple-700 text-[9px] bg-white dark:bg-[#222]" />
                      <button onClick={doLoyalty} disabled={loyalLoading} className="px-2 py-1 bg-purple-600 text-white rounded text-[9px] font-bold">{loyalLoading ? "..." : "Cari"}</button>
                    </div>
                  )}
                  {loyalErr && <p className="text-[8px] text-red-500">{loyalErr}</p>}
                </div>

                {/* Payment method */}
                <div className="flex gap-1.5">
                  <button onClick={() => setPm("cash")} className={clsx("flex-1 py-2 rounded-xl font-bold text-xs border-2 transition-all", pm === "cash" ? "bg-sabana text-white border-sabana shadow" : "bg-white dark:bg-[#222] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#444]")}>💵 TUNAI</button>
                  <button onClick={() => setPm("qris")} className={clsx("flex-1 py-2 rounded-xl font-bold text-xs border-2 transition-all", pm === "qris" ? "bg-blue-600 text-white border-blue-600 shadow" : "bg-white dark:bg-[#222] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#444]")}>📱 QRIS</button>
                </div>

                {pm === "cash" ? (
                  <>
                    {promo && <div className="flex justify-between text-[10px]"><span className="text-gray-500 line-through">{formatRupiah(total)}</span><span className="text-green-600 font-semibold">-{formatRupiah(promo.discount_amount)}</span></div>}
                    <div className="flex justify-between items-center"><span className="text-[10px] text-gray-500">Total</span><span className="text-sm font-bold text-sabana">{formatRupiah(fTotal)}</span></div>
                    <div className="bg-gray-50 dark:bg-[#222] rounded-xl p-2 text-center border border-gray-200 dark:border-[#444]">
                      <span className="text-xl font-mono font-bold text-gray-900 dark:text-gray-100">Rp {paid > 0 ? paid.toLocaleString("id-ID") : "0"}</span>
                    </div>
                    <Numpad value={cashIn} onChange={setCashIn} showQuickAmounts quickAmounts={qAmts} />
                    <div className={clsx("p-1.5 rounded-xl text-center", change > 0 ? "bg-green-50 dark:bg-green-900/20 border border-green-200" : "bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-[#444]")}>
                      <p className="text-[9px] text-gray-500">Kembalian</p>
                      <p className={clsx("text-sm font-bold", change > 0 ? "text-green-600" : "text-gray-400")}>{formatRupiah(change)}</p>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-2">
                    <QRCodeSVG value={`https://qris.sabana.id/pay?amount=${fTotal}&order=${Date.now()}`} size={130} level="H" includeMargin={false} />
                    <p className="text-xs text-gray-500 mt-1">Total: <span className="font-bold text-blue-600">{formatRupiah(fTotal)}</span></p>
                    <p className="text-[9px] text-gray-400">QR berlaku 15 menit</p>
                  </div>
                )}

                <div className="flex gap-1.5 pt-0.5">
                  <button onClick={onClose} className="px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 text-[10px] font-semibold">Batal</button>
                  <button onClick={doComplete} disabled={!enough || saving} className={clsx("flex-1 py-2 rounded-xl font-bold text-xs transition-all", saving ? "bg-gray-400 text-white" : enough ? "bg-green-600 text-white shadow hover:bg-green-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}>
                    {saving ? "Menyimpan..." : "✅ BAYAR"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* === RIGHT: Receipt === */}
        <div className="hidden sm:flex flex-col w-[260px] border-l border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-[#111] min-h-0">
          <div className="px-3 py-2 border-b border-gray-200 dark:border-[#333] shrink-0 flex items-center justify-between">
            <h3 className="font-heading font-bold text-xs text-gray-900 dark:text-gray-100">🧾 Struk</h3>
            {isPaid && <button onClick={doPrintBT} disabled={printing} className={clsx("px-2 py-0.5 rounded text-[9px] font-bold", printSt === "ok" ? "bg-green-500 text-white" : "bg-sabana text-white")}>{printSt === "ok" ? "✅" : "🖨️"} Print</button>}
          </div>
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            {isPaid ? (
              <pre className="text-[8px] leading-[1.4] text-gray-800 dark:text-gray-200 whitespace-pre font-mono">{rLines.join("\n")}</pre>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <span className="text-3xl mb-2 opacity-30">🧾</span>
                <p className="text-[10px]">Struk muncul</p>
                <p className="text-[10px]">setelah pembayaran</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
