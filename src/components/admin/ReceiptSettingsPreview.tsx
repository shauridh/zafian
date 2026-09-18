"use client";

import { buildReceiptLines } from "@/lib/receipt";

interface Props {
  width: 32 | 48;
  settings: { outletName: string; outletAddress: string; outletPhone: string; promoText: string; footer: string; showLogo: boolean };
}

export default function ReceiptSettingsPreview({ width, settings }: Props) {
  const lines = buildReceiptLines({
    items: [{ name: "Ayam Reguler", qty: 1, price: 89000 }, { name: "Nasi Putih", qty: 2, price: 5000 }, { name: "Kentang Goreng", qty: 1, price: 8000 }],
    subtotal: 107000,
    total: 107000,
    amountPaid: 110000,
    change: 3000,
    paymentMethod: "cash",
    cashierName: "Sabana",
    serviceMode: "Dine In",
    orderNumber: "PREVIEW",
    date: new Date().toLocaleString("id-ID"),
    outletName: settings.outletName,
    outletAddress: settings.outletAddress,
    outletPhone: settings.outletPhone,
    promoText: settings.promoText,
    footer: settings.footer,
  }, width);

  return <div className="min-w-0 rounded-xl bg-gray-100 p-3 dark:bg-[#222]">
    <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-gray-700 dark:text-gray-200">{width === 32 ? "58mm" : "80mm"}</span><span className="text-[10px] text-gray-400">{width} kolom</span></div>
    <pre className="receipt-preview overflow-x-auto rounded-lg bg-white p-3 text-[9px] leading-[1.35] text-gray-800 shadow-sm dark:bg-[#111] dark:text-gray-200">{lines.join("\n")}</pre>
  </div>;
}
