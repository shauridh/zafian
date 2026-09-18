"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import clsx from "clsx";
import Numpad from "@/components/ui/Numpad";
import { useCartStore } from "@/stores/cartStore";
import { useShiftStore } from "@/stores/shiftStore";
import { formatRupiah, formatDateTime, generateOrderNumber, SERVICE_MODE_LABELS } from "@/lib/format";
import { QRCodeSVG } from "qrcode.react";
import { buildReceiptLines } from "@/lib/receipt";
import ModalShell from "@/components/ui/ModalShell";
import { getReceiptSettings } from "@/lib/settings";
import { getActivePromos, calculateBestDiscount, type PromoResult } from "@/lib/promos";
import { getPrinter, isBluetoothAvailable } from "@/lib/printer";

export interface SplitPayment {
  method: "cash" | "qris";
  amount: number;
  reference?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (paymentMethod: string, amountPaid: number, splitPayments?: SplitPayment[]) => void;
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
  const [splitMode, setSplitMode] = useState(false);
  const [splitCash, setSplitCash] = useState("");
  const [cashIn, setCashIn] = useState("");
  const [platId, setPlatId] = useState("");
  const [promo, setPromo] = useState<PromoResult | null>(null);
  const [printSt, setPrintSt] = useState<"idle" | "ok" | "err">("idle");
  const [printing, setPrinting] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "ok" | "err">("idle");
  const autoPrintAttempted = useRef(false);
  const hasBT = isBluetoothAvailable();

  const [rSettings] = useState(() => getReceiptSettings());

  React.useEffect(() => {
    if (!isOpen || isOnlineFood || isPaid) return;
    (async () => { try { const p = await getActivePromos(); setPromo(calculateBestDiscount(p, total)); } catch {} })();
  }, [isOpen, total, isOnlineFood, isPaid]);

  React.useEffect(() => { if (isOpen && !isPaid) { setCashIn(""); setSplitCash(""); setSplitMode(false); setPm("cash"); } }, [isOpen, isPaid]);

  const fTotal = total - (promo?.discount_amount || 0);
  const paid = parseInt(cashIn) || 0;
  const change = pm === "cash" ? Math.max(0, paid - fTotal) : 0;
  const splitCashAmount = parseInt(splitCash) || 0;
  const splitQrisAmount = Math.max(0, fTotal - splitCashAmount);
  const splitEnough = splitCashAmount > 0 && splitQrisAmount > 0;
  const enough = isOnlineFood || splitMode ? splitEnough : pm === "qris" || paid >= fTotal;

  const qAmts = useMemo(() => [
    { label: "UANG PAS", value: fTotal },
    { label: "100K", value: 100000 }, { label: "150K", value: 150000 },
    { label: "200K", value: 200000 }, { label: "500K", value: 500000 },
  ], [fTotal]);

  const doComplete = useCallback(() => {
    if (isOnlineFood) onComplete("estimate", total);
    else if (splitMode && splitEnough) onComplete("split", fTotal, [
      { method: "cash", amount: splitCashAmount },
      { method: "qris", amount: splitQrisAmount },
    ]);
    else if (pm === "qris") onComplete("qris", fTotal);
    else if (enough) onComplete("cash", paid);
  }, [isOnlineFood, splitMode, splitEnough, splitCashAmount, splitQrisAmount, pm, enough, fTotal, total, paid, onComplete]);

  const withPrintTimeout = <T,>(promise: Promise<T>, timeoutMs = 10000): Promise<T> => Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error("Waktu koneksi printer habis")), timeoutMs)),
  ]);

  const doPrintBT = async (automatic = false) => {
    // Automatic printing must never block the cashier-facing action button.
    // Manual printing still shows a busy state while the printer responds.
    if (!automatic) setPrinting(true);
    setPrintSt("idle");
    try {
      const p = getPrinter();
      const connected = await withPrintTimeout(p.connect({ requestPermission: !automatic }), automatic ? 2500 : 10000);
      if (!connected || !paymentResult) {
        setPrintSt("err");
      } else {
        const ok = await withPrintTimeout(p.printReceipt({
          items: items.map(i => ({ name: i.name, qty: i.quantity, price: i.price })),
          subtotal: total, discount: promo?.discount_amount, total,
          amountPaid: paymentResult.amountPaid, change: paymentResult.change,
          paymentMethod: paymentResult.method, cashierName: cashierName || "Kasir",
          serviceMode: SERVICE_MODE_LABELS[serviceMode] || serviceMode,
          orderNumber: savedOrderId || `#${orderNumber}`, date: formatDateTime(new Date()),
          outletName: rSettings.outletName, outletAddress: rSettings.outletAddress, outletPhone: rSettings.outletPhone,
          promoText: rSettings.promoText, footer: rSettings.footer,
        }), automatic ? 10000 : 20000);
        setPrintSt(ok ? "ok" : "err");
      }
    } catch { setPrintSt("err"); }
    finally {
      setTimeout(() => setPrintSt("idle"), 2000);
      setPrinting(false);
    }
  };

  const shareReceipt = async () => {
    const text = rLines.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Struk Sabana Fried Chicken", text });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setShareStatus("ok");
    } catch {
      setShareStatus("err");
    }
    setTimeout(() => setShareStatus("idle"), 2000);
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

  React.useEffect(() => {
    if (!isOpen || !isPaid) {
      autoPrintAttempted.current = false;
      return;
    }
    if (rSettings.autoPrint && !autoPrintAttempted.current) {
      autoPrintAttempted.current = true;
      void doPrintBT(true);
    }
  }, [isOpen, isPaid, rSettings.autoPrint]);

  if (!isOpen) return null;

  return (
    <ModalShell open={isOpen} onClose={onClose} className={isPaid ? "max-w-[440px]" : "max-w-[760px]"}>
      {isPaid ? (
        <div className="flex max-h-[calc(100vh-24px)] flex-col overflow-hidden bg-white dark:bg-[#1a1a1a]">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-[#333]">
            <div>
              <h2 className="font-heading text-sm font-bold text-gray-900 dark:text-gray-100">✅ Pembayaran Selesai</h2>
              <p className="text-[10px] text-gray-500">Transaksi berhasil disimpan</p>
            </div>
            <button onClick={onClose} aria-label="Tutup modal" className="rounded-lg p-1.5 text-xs text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333]">✕</button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
            <div className="flex items-center justify-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-center dark:bg-green-900/20">
              <span className="text-xl">✅</span>
              <div>
                <p className="text-xs font-bold text-green-700 dark:text-green-300">Pembayaran Berhasil</p>
                <p className="text-[10px] text-gray-500">{formatRupiah(paymentResult!.amountPaid)} · {paymentResult!.method === "cash" ? "TUNAI" : paymentResult!.method.toUpperCase()} · Kembalian {formatRupiah(paymentResult!.change)}</p>
              </div>
            </div>

            <div className="min-h-0 rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-[#333] dark:bg-[#111]">
              <div className="mb-1.5 flex items-center justify-between border-b border-gray-200 pb-1.5 dark:border-[#333]">
                <h3 className="font-heading text-xs font-bold text-gray-900 dark:text-gray-100">🧾 Struk</h3>
                <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400">FINAL</span>
              </div>
              <pre className="overflow-hidden whitespace-pre font-mono text-[8px] leading-[1.35] text-gray-800 dark:text-gray-200">{rLines.join("\n")}</pre>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={hasBT ? () => void doPrintBT() : () => window.print()} disabled={printing} aria-busy={printing} className={clsx("rounded-xl py-2.5 text-[10px] font-bold transition-all", printSt === "ok" ? "bg-green-500 text-white" : printSt === "err" ? "bg-red-500 text-white" : "bg-sabana text-white shadow-lg shadow-sabana/30")}>
                {printSt === "ok" ? "✅ Tercetak" : printSt === "err" ? "⚠️ Print gagal" : hasBT ? "🖨️ Print BT" : "🖨️ Print"}
              </button>
              <button onClick={shareReceipt} className={clsx("rounded-xl py-2.5 text-[10px] font-bold", shareStatus === "ok" ? "bg-green-100 text-green-700" : shareStatus === "err" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600 dark:bg-[#333] dark:text-gray-300")}>
                {shareStatus === "ok" ? "✅ Tersalin" : shareStatus === "err" ? "Gagal" : "📤 Bagikan"}
              </button>
            </div>

            <button onClick={onClose} className="w-full rounded-xl bg-green-600 py-3 text-xs font-bold text-white shadow-lg shadow-green-600/30 hover:bg-green-700">🛒 Transaksi Baru</button>
          </div>
        </div>
      ) : (
      <div className="payment-modal-compact relative flex max-h-[calc(100vh-24px)] flex-col overflow-hidden dark:bg-[#1a1a1a] md:flex-row">

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

          <div className="flex-1 overflow-hidden p-2.5 min-h-0">
            {isOnlineFood ? (
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
                  <button onClick={() => { setPm("cash"); setSplitMode(false); }} className={clsx("flex-1 py-2 rounded-xl font-bold text-xs border-2 transition-all", !splitMode && pm === "cash" ? "bg-sabana text-white border-sabana shadow" : "bg-white dark:bg-[#222] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#444]")}>💵 TUNAI</button>
                  <button onClick={() => { setPm("qris"); setSplitMode(false); }} className={clsx("flex-1 py-2 rounded-xl font-bold text-xs border-2 transition-all", !splitMode && pm === "qris" ? "bg-blue-600 text-white border-blue-600 shadow" : "bg-white dark:bg-[#222] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#444]")}>📱 QRIS</button>
                  <button onClick={() => setSplitMode(true)} className={clsx("flex-1 py-2 rounded-xl font-bold text-xs border-2 transition-all", splitMode ? "bg-purple-600 text-white border-purple-600 shadow" : "bg-white dark:bg-[#222] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#444]")}>↔ Split</button>
                </div>

                {splitMode && (
                  <div className="rounded-xl border border-purple-200 bg-purple-50 p-2 dark:border-purple-800 dark:bg-purple-900/20">
                    <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold text-purple-800 dark:text-purple-200">Pembayaran gabungan</span><span className="text-[10px] text-gray-500">Total {formatRupiah(fTotal)}</span></div>
                    <label className="mb-1 block text-[9px] text-gray-500">Bagian Tunai</label>
                    <Numpad value={splitCash} onChange={setSplitCash} quickAmounts={[{ label: "50%", value: Math.floor(fTotal / 2) }, { label: "UANG PAS", value: fTotal }]} showQuickAmounts />
                    <div className="mt-2 flex justify-between rounded-lg bg-white px-2 py-1.5 text-[10px] dark:bg-[#222]"><span>Cash {formatRupiah(splitCashAmount)}</span><span>QRIS {formatRupiah(splitQrisAmount)}</span></div>
                    {splitCashAmount >= fTotal && <p className="mt-1 text-[9px] text-red-600">Nominal cash harus lebih kecil dari total agar ada bagian QRIS.</p>}
                  </div>
                )}

                {!splitMode && (pm === "cash" ? (
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
                ))}
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
          <div className="flex-1 overflow-hidden p-2 min-h-0">
            <pre className="text-[8px] leading-[1.4] text-gray-800 dark:text-gray-200 whitespace-pre font-mono">{rLines.join("\n")}</pre>
          </div>
        </div>
      </div>
      )}
    </ModalShell>
  );
}
