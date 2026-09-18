"use client";

import React, { useState } from "react";
import { formatRupiah } from "@/lib/format";
import ModalShell from "@/components/ui/ModalShell";
import Numpad from "@/components/ui/Numpad";

type CashInOut = {
  id: string;
  type: "in" | "out";
  amount: number;
  note: string;
  created_at: string;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Cash In/Out recorder for the POS header (💰).
 * Stays mounted so "Riwayat Hari Ini" survives open/close cycles.
 */
export default function CashInOutModal({ isOpen, onClose }: Props) {
  const [type, setType] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [list, setList] = useState<CashInOut[]>([]);

  if (!isOpen) return null;

  const handleSave = () => {
    const value = parseInt(amount) || 0;
    if (value <= 0) return alert("Jumlah harus lebih dari 0!");
    setList((prev) => [...prev, { id: Date.now().toString(), type, amount: value, note: note || (type === "in" ? "Cash In" : "Cash Out"), created_at: new Date().toISOString() }]);
    setAmount(""); setNote(""); onClose();
  };

  return (
    <ModalShell open={isOpen} onClose={onClose} className="max-w-xs">
      <div className="p-4">
        <h3 className="font-heading font-bold text-base mb-3 dark:text-gray-100">💰 Cash In / Cash Out</h3>
        <div className="flex gap-2 mb-3">
          <button onClick={() => setType("in")} className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${type === "in" ? "bg-green-500 text-white shadow-lg" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>💵 Cash In</button>
          <button onClick={() => setType("out")} className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${type === "out" ? "bg-red-500 text-white shadow-lg" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>💸 Cash Out</button>
        </div>
        <div className="space-y-2 mb-3">
          <div className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-center font-mono text-lg font-bold text-gray-900 dark:border-[#444] dark:bg-[#222] dark:text-gray-100">
            Rp {amount ? parseInt(amount).toLocaleString("id-ID") : "0"}
          </div>
          <Numpad
            value={amount}
            onChange={setAmount}
            showQuickAmounts
            quickAmounts={[10000, 20000, 50000, 100000].map((value) => ({ label: formatRupiah(value), value }))}
          />
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan..." className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-xs" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 font-semibold text-xs">Batal</button>
          <button onClick={handleSave} className={`flex-1 py-2 rounded-xl font-bold text-white text-xs ${type === "in" ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"}`}>Simpan</button>
        </div>
        {list.length > 0 && (
          <div className="mt-3 border-t dark:border-[#333] pt-2 max-h-28 overflow-y-auto">
            <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Riwayat Hari Ini</p>
            {list.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${entry.type === "in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{entry.type === "in" ? "IN" : "OUT"}</span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[100px]">{entry.note}</span>
                </div>
                <span className={`text-[10px] font-bold ${entry.type === "in" ? "text-green-600" : "text-red-600"}`}>{entry.type === "in" ? "+" : "-"}{formatRupiah(entry.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
