"use client";

import React, { useState, useMemo, useCallback } from "react";
import clsx from "clsx";
import Numpad from "@/components/ui/Numpad";
import { useCartStore } from "@/stores/cartStore";
import { useShiftStore } from "@/stores/shiftStore";
import { formatRupiah, formatDateTime, generateOrderNumber, SERVICE_MODE_LABELS } from "@/lib/format";
import { QRCodeSVG } from "qrcode.react";
import { buildReceiptLines } from "@/lib/receipt";
import { getReceiptSettings } from "@/lib/settings";
import { getActivePromos, calculateBestDiscount, type PromoResult } from "@/lib/promos";
import { getPrinter, isBluetoothAvailable } from "@/lib/printer";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (paymentMethod: string, amountPaid: number) => void;
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
  const [promo, setPromo] = useState<PromoResult | null>(null);
  const [printSt, setPrintSt] = useState<"idle" | "ok" | "err">("idle");
  const [printing, setPrinting] = useState(false);
  const hasBT = isBluetoothAvailable();

  const [rSettings] = useState(() => getReceiptSettings());

  React.useEffect(() => {
    if (!isOpen || isOnlineFood || isPaid) return;
    (async () => { try { const p = await getActivePromos(); setPromo(calculateBestDiscount(p, total)); } catch {} })();
  }, [isOpen, total, isOnlineFood, isPaid]);

  React.useEffect(() => { if (isOpen && !isPaid) { setCashIn(""); setPm("cash"); } }, [isOpen, isPaid]);

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
    if (isOnlineFood) onComplete("estimate", total);
    else if (pm === "qris") onComplete("qris", fTotal);
    else if (enough) onComplete("cash", paid);
  }, [isOnlineFood, pm, enough, fTotal, total, paid, onComplete]);

  const doPrintBT = async () => {
    setPrinting(true); setPrintSt("idle");
    try {
      const p = getPrinter();
      if (!(await p.connect())) { setPrintSt("err"); setTimeout(() => setPrintSt("idle"), 2000); return; }
      if (!paymentResult) return;
      const ok = await p.printReceipt({
        items: items.map(i => ({ name: i.name, qty: i.quantity, price: i.price })),
        subtotal: total, discount: promo?.discount_amount, total,
        amountPaid: paymentResult.amountPaid, change: paymentResult.change,
        paymentMethod: paymentResult.method, cashierName: cashierName || "Kasir",
        serviceMode: SERVICE_MODE_LABELS[serviceMode] || serviceMode,
        orderNumber: savedOrderId || `#${orderNumber}`, date: formatDateTime(new Date()),
        outletName: rSettings.outletName, outletAddress: rSettings.outletAddress, outletPhone: rSettings.outletPhone,
        footer: rSettings.footer,
      });
      setPrintSt(ok ? "ok" : "err");
    } catch { setPrintSt("err"); }
    setTimeout(() => setPrintSt("idle"), 2000);
    setPrinting(false);
  };

  // Receipt lines — live before payment, final after payment
  const rLines = useMemo(() => buildReceiptLines({
    items: items.map(i => ({ name: i.name, qty: i.quantity, price: i.price })),
    subtotal: total,
    discount: promo?.discount_amount,
    total: fTotal,
    amountPaid: isPaid && paymentResult ? paymentResult.amountPaid : (pm === "cash" ? paid : fTotal),
    change: isPaid && paymentResult ? paymentResult.change : (pm === "cash" ? Math.max(0, paid - fTotal) : 0),
    paymentMethod: isPaid && paymentResult
      ? paymentResult.method
      : (isOnlineFood ? "estimate" : pm),
    cashierName: cashierName || "Kasir",
    serviceMode: SERVICE_MODE_LABELS[serviceMode] || serviceMode,
    orderNumber: savedOrderId || generateOrderNumber(orderNumber, serviceMode),
    date: formatDateTime(new Date()),
    outletName: rSettings.outletName,
    outletAddress: rSettings.outletAddress,
    outletPhone: rSettings.outletPhone,
    footer: rSettings.footer,
  }), [isPaid, paymentResult, items, total, fTotal, paid, pm, isOnlineFood, promo, orderNumber, serviceMode, savedOrderId, cashierName, rSettings]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex flex-col md:flex-row w-full max-w-[820px] md:h-auto max-h-[94vh] bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl overflow-hidden">

        {/* === LEFT: Payment === */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 md:max-h-[76vh]">
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
              /* === PAID — langsung tombol Transaksi Baru, tanpa panel tambahan === */
              <div className="flex flex-col items-center justify-center min-h-full gap-2.5 py-2">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-2xl">✅</div>
                <div className="text-center">
                  <p className="font-bold text-green-700 dark:text-green-300 text-sm">Pembayaran Berhasil</p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatRupiah(paymentResult!.amountPaid)} · {paymentResult!.method === "cash" ? "TUNAI" : paymentResult!.method.toUpperCase()}</p>
                  <p className="text-xs text-green-600 font-semibold mt-0.5">Kembalian: {formatRupiah(paymentResult!.change)}</p>
                </div>
                <div className="flex gap-2 w-full max-w-[240px] pt-1">
                  {hasBT && (
                    <button onClick={doPrintBT} disabled={printing} className={clsx("flex-1 py-2.5 rounded-xl text-[11px] font-bold transition-all",
                      printSt === "ok" ? "bg-green-500 text-white" : printSt === "err" ? "bg-red-500 text-white" : "bg-sabana text-white shadow-lg shadow-sabana/30"
                    )}>{printSt === "ok" ? "✅ Tercetak" : printing ? "..." : "🖨️ Print BT"}</button>
                  )}
                  <button onClick={() => window.print()} className="flex-1 py-2.5 rounded-xl text-[11px] font-bold bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400">📄 Browser</button>
                </div>
                <button onClick={onClose} className="w-full max-w-[240px] py-3 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 shadow-lg shadow-green-600/30">
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
              </div>
            )}
          </div>

          {/* Action bar — sticky di bawah, tidak pernah terpotong scroll */}
          {!isPaid && (
            <div className="px-2.5 py-2 border-t border-gray-200 dark:border-[#333] shrink-0 bg-white dark:bg-[#1a1a1a]">
              <div className="flex gap-1.5">
                <button onClick={onClose} className="px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 text-[10px] font-semibold">Batal</button>
                <button onClick={doComplete} disabled={!enough || saving} className={clsx("flex-1 py-2 rounded-xl font-bold text-xs transition-all", saving ? "bg-gray-400 text-white" : enough ? "bg-green-600 text-white shadow hover:bg-green-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}>
                  {saving ? "Menyimpan..." : "✅ BAYAR"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* === RIGHT: Live Receipt — selalu tampil (samping di tablet, bawah di layar kecil) === */}
        <div className="flex flex-col md:w-[270px] max-h-[26vh] md:max-h-[76vh] border-t md:border-t-0 md:border-l border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-[#111] min-h-0 shrink-0">
          <div className="px-3 py-2 border-b border-gray-200 dark:border-[#333] shrink-0 flex items-center justify-between">
            <h3 className="font-heading font-bold text-xs text-gray-900 dark:text-gray-100">🧾 Struk</h3>
            <span className={clsx("text-[9px] font-bold px-1.5 py-0.5 rounded-full", isPaid ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-200 text-gray-500 dark:bg-[#333] dark:text-gray-400")}>
              {isPaid ? "FINAL" : "PREVIEW"}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            <pre className="text-[8px] leading-[1.4] text-gray-800 dark:text-gray-200 whitespace-pre font-mono">{rLines.join("\n")}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
