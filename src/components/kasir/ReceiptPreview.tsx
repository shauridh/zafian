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

  const receiptText = `
╔═══════════════════════════════════╗
║      🍗 SABANA FRIED CHICKEN      ║
║      Jl. Contoh No. 123           ║
║      Telp: 0812-xxxx-xxxx         ║
╠═══════════════════════════════════╣
║  ${formatDateTime(now).padEnd(28)}║
║  ${savedOrderId ? savedOrderId.slice(0, 28) : generateOrderNumber(orderNumber, serviceMode).padEnd(28)}║
║  Kasir: ${cashierName.padEnd(21)}║
║  ${SERVICE_MODE_LABELS[serviceMode].padEnd(28)}║
╠═══════════════════════════════════╣
${items.map((item) => {
  const line = `${item.quantity}x ${item.name}`;
  const price = formatRupiah(item.price * item.quantity);
  return `║  ${line.padEnd(20)}${price.padStart(12)} ║`;
}).join("\n")}
╠═══════════════════════════════════╣
║  Subtotal:${"".padEnd(17)}${formatRupiah(total + discount).padStart(10)} ║
${discount > 0 ? `║  Diskon:${"".padEnd(19)}-${formatRupiah(discount).padStart(9)} ║\n` : ""}║  TOTAL:${"".padEnd(20)}${formatRupiah(total).padStart(10)} ║
║  BAYAR:${"".padEnd(21)}${formatRupiah(amountPaid).padStart(10)} ║
║  KEMBALIAN:${"".padEnd(17)}${formatRupiah(changeAmount).padStart(10)} ║
║  Metode: ${(paymentMethod === "cash" ? "TUNAI" : paymentMethod === "estimate" ? "ESTIMASI" : "QRIS").padEnd(19)}║
╠═══════════════════════════════════╣
║  Terima kasih! Sampai jumpa!      ║
║  🍗 Sabana Fried Chicken 🍗       ║
╚═══════════════════════════════════╝`;

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
        outletName: "SABANA FRIED CHICKEN",
        outletAddress: "Jl. Contoh No. 123",
        outletPhone: "Telp: 0812-xxxx-xxxx",
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
        <h2 className="text-xl font-heading font-bold text-center mb-4">🧾 Struk Pesanan</h2>

        {/* Receipt Preview */}
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-4 mb-6 overflow-x-auto">
          <pre className="receipt-preview text-xs leading-relaxed text-gray-800 whitespace-pre">
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
            className="flex flex-col items-center gap-1 py-4 rounded-xl bg-gray-100 text-gray-700 
                       font-semibold hover:bg-gray-200 transition-all"
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
            className="flex flex-col items-center gap-1 py-4 rounded-xl bg-gray-100 text-gray-700 
                       font-semibold hover:bg-gray-200 transition-all"
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
            className="w-full py-2.5 mt-2 rounded-xl border-2 border-red-200 text-danger font-semibold text-sm hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {cancelling ? "Membatalkan..." : "❌ Batalkan Order"}
          </button>
        )}

        <button onClick={onClose} variant="ghost" className="w-full py-3 text-gray-500 font-medium hover:text-gray-700">
          ✕ Tutup
        </button>
      </div>
    </Modal>
  );
}
