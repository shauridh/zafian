"use client";

import React from "react";
import clsx from "clsx";

interface Table {
  id: number;
  name: string;
  seats: number;
  status: "available" | "occupied" | "reserved";
}

interface TableSelectorProps {
  selectedTable: number | null;
  onSelect: (tableId: number | null) => void;
  visible: boolean;
}

const TABLES: Table[] = [
  { id: 1, name: "Meja 1", seats: 2, status: "available" },
  { id: 2, name: "Meja 2", seats: 2, status: "available" },
  { id: 3, name: "Meja 3", seats: 4, status: "available" },
  { id: 4, name: "Meja 4", seats: 4, status: "available" },
  { id: 5, name: "Meja 5", seats: 6, status: "available" },
  { id: 6, name: "Meja 6", seats: 6, status: "available" },
  { id: 7, name: "Meja 7", seats: 8, status: "available" },
  { id: 8, name: "Meja VIP", seats: 10, status: "available" },
];

export default function TableSelector({ selectedTable, onSelect, visible }: TableSelectorProps) {
  if (!visible) return null;

  return (
    <div className="bg-white dark:bg-[#1a1a1a] rounded-xl p-3 border border-gray-200 dark:border-[#333] mb-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-600">🪑 Pilih Meja</p>
        <button onClick={() => onSelect(null)} className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">Tidak pakai meja</button>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {TABLES.map((table) => (
          <button
            key={table.id}
            onClick={() => onSelect(table.id === selectedTable ? null : table.id)}
            className={clsx(
              "flex flex-col items-center gap-0.5 p-2 rounded-lg border-2 transition-all text-center",
              selectedTable === table.id
                ? "border-sabana bg-sabana-50 dark:bg-sabana/10 shadow-sm"
                : "border-gray-200 dark:border-[#333] hover:border-gray-300 dark:hover:border-[#444]"
            )}
          >
            <span className="text-lg">{selectedTable === table.id ? "🪑" : "⬜"}</span>
            <span className="text-[10px] font-semibold text-gray-900 dark:text-gray-100">{table.name}</span>
            <span className="text-[9px] text-gray-400 dark:text-gray-500">{table.seats} kursi</span>
          </button>
        ))}
      </div>
    </div>
  );
}
