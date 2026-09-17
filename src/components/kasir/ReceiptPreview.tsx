"use client";

import React, { useState } from "react";
import Modal from "@/components/ui/Modal";
import { useCartStore } from "@/stores/cartStore";
import { useShiftStore } from "@/stores/shiftStore";
import { getPrinter, isBluetoothAvailable } from "@/lib/printer";
import { formatRupiah, formatDateTime, generateOrderNumber, SERVICE_MODE_LABELS } from "@/lib/format";
import { supabase } from "@/lib/supabase/client";

interface ReceiptPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  orderNumber: number;
  amountPaid: number;
  paymentMethod: string;
  changeAmount: number;
  savedOrderId?: string | null;
}

export default function ReceiptPreview({
  isOpen,
  onClose,
  orderNumber,
  amountPaid,
  paymentMethod,
  changeAmount,
  savedOrderId,
}: ReceiptPreviewProps) {
  const { items, getTotal, serviceMode, getDiscountAmount, clearCart } = useCartStore();
  const { cashierName } = useShiftStore();
  const [cancelling, setCancelling] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<"idle" | "connecting" | "printing" | "done" | "error">("idle");

  const total = getTotal();
  const discount = getDiscountAmount();
  const now = new Date();
  const hasBluetooth = isBluetoothAvailable();

  // Load receipt settings from localStorage
  const [receiptSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("sabana-receipt-settings");
      return saved ? JSON.parse(saved) : { outletName: "SABANA FRIED CHICKEN", outletAddress: "Jl. Contoh No. 123", outletPhone: "0812-xxxx-xxxx", footer: "Terima kasih! Sampai jumpa! 🍗" };
    } catch { return { outletName: "SABANA FRIED CHICKEN", outletAddress: "Jl. Contoh No. 123", outletPhone: "0812-xxxx-xxxx", footer: "Terima kasih! Sampai jumpa! 🍗" }; }
  });

  const method = paymentMethod === "cash" ? "TUNAI" : paymentMethod === "estimate" ? "ESTIMASI" : "QRIS";
  const W = 35;
  const pad = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + "\u2026" : s.padEnd(w);
  const sep = (c: string) => c.repeat(W);

  const receiptText = [
    sep("="),
    `  ${pad(receiptSettings.outletName, W - 4)}`,
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
    `  Subtotal:${" ".repeat(W - 21)}${formatRupiah(total + discount)}`,
    ...(discount > 0 ? [`  Diskon:${" ".repeat(W - 19)}-${formatRupiah(discount)}`] : []),
    `  TOTAL:${" ".repeat(W - 19)}${formatRupiah(total)}`,
    `  BAYAR:${" ".repeat(W - 18)}${formatRupiah(amountPaid)}`,
    `  KEMBALIAN:${" ".repeat(W - 20)}${formatRupiah(changeAmount)}`,
    sep("-"),
    `  Metode: ${method}`,
    sep("="),
    `  ${pad(receiptSettings.footer || "Terima kasih!", W - 4)}`,
    `  Sabana Fried Chicken`,
  ].filter(Boolean).join("\n");

  const handlePrintBluetooth = async () => {
    setPrinting(true);
    setPrintStatus("connecting");

    try {
      const printer = getPrinter();
      
      // Try to connect
      setPrintStatus("connecting");
      const connected = await printer.connect();
      
      if (!connected) {
        setPrintStatus("error");
        setTimeout(() => setPrintStatus("idle"), 2000);
        return;
      }

      setPrintStatus("printing");
      
      // Print receipt
      const success = await printer.printReceipt({
        items: items.map((item) => ({
          name: item.name,
          qty: item.quantity,
          price: item.price,
        })),
        subtotal: total + discount,
        discount: discount > 0 ? discount : undefined,
        total,
        amountPaid,
        change: changeAmount,
        paymentMethod: paymentMethod === "estimate" ? "Estimasi" : paymentMethod,
        cashierName: cashierName || "Kasir",
        serviceMode: SERVICE_MODE_LABELS[serviceMode] || serviceMode,
        orderNumber: savedOrderId || `#${orderNumber}`,
        date: formatDateTime(now),
        outletName: receiptSettings.outletName || "SABANA FRIED CHICKEN",
        outletAddress: receiptSettings.outletAddress || "",
        outletPhone: receiptSettings.outletPhone || "",
      });

      setPrintStatus(success ? "done" : "error");
      setTimeout(() => setPrintStatus("idle"), 2000);
    } catch (err) {
      console.error("Print error:", err);
      setPrintStatus("error");
      setTimeout(() => setPrintStatus("idle"), 2000);
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintBrowser = () => {
    window.print();
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(receiptText);
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const handleDownload = () => {
    const blob = new Blob([receiptText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${orderNumber}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <div className="p-6">
        <h2 className="text-xl font-heading font-bold text-center mb-4 text-gray-900 dark:text-gray-100">🧾 Struk Pesanan</h2>

        {/* Receipt Preview */}
        <div className="bg-white dark:bg-[#1a1a1a] border-2 border-dashed border-gray-300 dark:border-[#555] rounded-xl p-4 mb-6 overflow-x-auto">
          <pre className="receipt-preview text-xs leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre">
            {receiptText}
          </pre>
        </div>

        {/* Print Options */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {/* Bluetooth Thermal Printer */}
          <button
            onClick={handlePrintBluetooth}
            disabled={printing}
            className={`flex flex-col items-center gap-1 py-4 rounded-xl font-semibold transition-all ${
              printStatus === "done"
                ? "bg-success text-white"
                : printStatus === "error"
                ? "bg-danger text-white"
                : printStatus === "connecting" || printStatus === "printing"
                ? "bg-sabana text-white animate-pulse"
                : "bg-sabana text-white hover:bg-sabana-dark"
            }`}
          >
            <span className="text-xl">
              {printStatus === "done" ? "✅" : printStatus === "error" ? "❌" : printStatus === "connecting" ? "🔄" : printStatus === "printing" ? "🖨️" : "🖨️"}
            </span>
            <span className="text-xs">
              {printStatus === "connecting" ? "Menyambung..." : printStatus === "printing" ? "Mencetak..." : printStatus === "done" ? "Tercetak!" : printStatus === "error" ? "Gagal" : "Printer BT"}
            </span>
            {!hasBluetooth && (
              <span className="text-[9px] opacity-70">Chrome/Edge only</span>
            )}
          </button>

          {/* Browser Print */}
          <button
            onClick={handlePrintBrowser}
            className="flex flex-col items-center gap-1 py-4 rounded-xl bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-300
                       font-semibold hover:bg-gray-200 dark:hover:bg-[#444] transition-all"
          >
            <span className="text-xl">📄</span>
            <span className="text-xs">Print Browser</span>
          </button>

          {/* WhatsApp */}
          <button
            onClick={handleShareWhatsApp}
            className="flex flex-col items-center gap-1 py-4 rounded-xl bg-success text-white 
                       font-semibold hover:bg-green-700 transition-all"
          >
            <span className="text-xl">📱</span>
            <span className="text-xs">WhatsApp</span>
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            className="flex flex-col items-center gap-1 py-4 rounded-xl bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-300
                       font-semibold hover:bg-gray-200 dark:hover:bg-[#444] transition-all"
          >
            <span className="text-xl">💾</span>
            <span className="text-xs">Download</span>
          </button>
        </div>

        {/* Cancel Order */}
        {savedOrderId && (
          <button
            onClick={async () => {
              if (!confirm("Batalkan order ini? Stok akan dikembalikan.")) return;
              setCancelling(true);
              try {
                await supabase.from("orders").update({ status: "cancelled" }).eq("id", savedOrderId);
                alert("Order dibatalkan!");
                onClose();
              } catch (err) {
                alert("Gagal membatalkan order");
              } finally {
                setCancelling(false);
              }
            }}
            disabled={cancelling}
            className="w-full py-2.5 mt-2 rounded-xl border-2 border-red-200 dark:border-red-500/30 text-danger font-semibold text-sm hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            {cancelling ? "Membatalkan..." : "❌ Batalkan Order"}
          </button>
        )}

        <button onClick={onClose} className="w-full py-3 text-gray-500 dark:text-gray-400 font-medium hover:text-gray-700 dark:hover:text-gray-200">
          ✕ Tutup
        </button>
      </div>
    </Modal>
  );
}
