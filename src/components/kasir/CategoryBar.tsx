"use client";

import React from "react";
import clsx from "clsx";
import { Category } from "@/types";

interface CategoryBarProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showBestSellers?: boolean;
  onToggleBestSellers?: () => void;
  bestSellerCount?: number;
}

export default function CategoryBar({
  categories,
  selectedId,
  onSelect,
  showBestSellers = false,
  onToggleBestSellers,
  bestSellerCount = 0,
}: CategoryBarProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
      <button
        onClick={() => onSelect(null)}
        className={clsx(
          "px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-all duration-200",
          "min-w-[56px] sm:min-w-[64px] cursor-pointer whitespace-nowrap",
          selectedId === null
            ? "bg-sabana text-white shadow-lg shadow-sabana/30"
            : "bg-white dark:bg-[#1e1e1e] text-gray-700 dark:text-gray-300 hover:bg-sabana-50 dark:hover:bg-sabana/10 border border-gray-200 dark:border-[#333]"
        )}
      >
        <span className="text-[10px] sm:text-xs font-semibold">Semua</span>
      </button>
      {selectedId === null && onToggleBestSellers && (
        <button
          onClick={onToggleBestSellers}
          className={clsx(
            "px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-all duration-200 min-w-[76px] cursor-pointer whitespace-nowrap border",
            showBestSellers
              ? "bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-500/20"
              : "bg-white dark:bg-[#1e1e1e] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-[#333] hover:bg-amber-50 dark:hover:bg-amber-900/20"
          )}
          title="Tampilkan produk terlaris pada shift aktif"
        >
          <span className="text-[10px] sm:text-xs font-semibold">★ Terlaris{bestSellerCount > 0 ? ` (${bestSellerCount})` : ""}</span>
        </button>
      )}
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={clsx(
            "px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-all duration-200",
            "min-w-[56px] sm:min-w-[64px] cursor-pointer whitespace-nowrap",
            selectedId === cat.id
              ? "bg-sabana text-white shadow-lg shadow-sabana/30"
              : "bg-white dark:bg-[#1e1e1e] text-gray-700 dark:text-gray-300 hover:bg-sabana-50 dark:hover:bg-sabana/10 border border-gray-200 dark:border-[#333]"
          )}
        >
          <span className="text-[10px] sm:text-xs font-semibold">{cat.name}</span>
        </button>
      ))}
    </div>
  );
}
