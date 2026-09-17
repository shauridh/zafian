"use client";

import { formatRupiah } from "@/lib/format";
import { useCartStore } from "@/stores/cartStore";

export interface PreOrderData {
  isPreOrder: boolean;
  eventName: string;
  eventDate: string;
  dpAmount: number;
  dpPaid: boolean;
  remainingPayment: string;
}

export const EMPTY_PREORDER: PreOrderData = { isPreOrder: false, eventName: "", eventDate: "", dpAmount: 0, dpPaid: false, remainingPayment: "cash" };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  preOrder: PreOrderData;
  onChange: (p: PreOrderData) => void;
}

/** Pre-Order Event modal (📅) — event orders with down payment (DP). */
export default function PreOrderModal({ isOpen, onClose, preOrder, onChange }: Props) {
  const { getTotal } = useCartStore();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#1a1a1a] rounded-2xl w-full max-w-xs p-4 shadow-2xl max-h-[85vh] overflow-y-auto">
        <h3 className="font-heading font-bold text-base mb-0.5 dark:text-gray-100">📅 Pre-Order Event</h3>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-3">Pesan untuk acara dengan DP</p>
        <div className="space-y-2 mb-3">
          <div>
            <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">Nama Acara *</label>
            <input type="text" value={preOrder.eventName} onChange={(e) => onChange({ ...preOrder, eventName: e.target.value })} placeholder="Ulang Tahun, Resepsi..." className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-xs" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">Tanggal Acara</label>
            <input type="date" value={preOrder.eventDate} onChange={(e) => onChange({ ...preOrder, eventDate: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-xs" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">DP *</label>
            <input type="number" value={preOrder.dpAmount || ""} onChange={(e) => onChange({ ...preOrder, dpAmount: parseInt(e.target.value) || 0 })} placeholder="0" className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-base font-bold font-mono" />
            <div className="flex gap-1.5 mt-1.5">
              {[100000, 200000, 500000].map((v) => (
                <button key={v} onClick={() => onChange({ ...preOrder, dpAmount: v })} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${preOrder.dpAmount === v ? "bg-sabana text-white" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>{formatRupiah(v)}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">Pelunasan</label>
            <div className="flex gap-1.5">
              {["cash", "qris", "transfer"].map((m) => (
                <button key={m} onClick={() => onChange({ ...preOrder, remainingPayment: m })} className={`flex-1 py-2 rounded-xl text-[10px] font-bold transition-all ${preOrder.remainingPayment === m ? "bg-sabana text-white" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>{m === "cash" ? "💵 Tunai" : m === "qris" ? "📱 QRIS" : "🏦 Transfer"}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="bg-sabana-50 dark:bg-sabana/10 rounded-xl p-2 mb-3">
          <div className="flex justify-between text-xs"><span className="text-gray-600 dark:text-gray-400">Total</span><span className="font-bold text-gray-800 dark:text-gray-200">{formatRupiah(getTotal())}</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-600 dark:text-gray-400">DP</span><span className="font-bold text-sabana">-{formatRupiah(preOrder.dpAmount)}</span></div>
          <div className="flex justify-between text-xs font-bold border-t dark:border-[#444] mt-1 pt-1"><span className="text-gray-800 dark:text-gray-200">Sisa</span><span className="text-sabana">{formatRupiah(Math.max(0, getTotal() - preOrder.dpAmount))}</span></div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 font-semibold text-xs">Batal</button>
          <button onClick={() => { onChange({ ...preOrder, isPreOrder: true }); onClose(); }} disabled={!preOrder.eventName} className="flex-1 py-2 rounded-xl bg-sabana text-white font-bold text-xs disabled:opacity-50">Simpan</button>
        </div>
      </div>
    </div>
  );
}
