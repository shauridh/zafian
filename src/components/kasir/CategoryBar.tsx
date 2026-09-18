"use client";

import React from "react";
import clsx from "clsx";
import { Category } from "@/types";

interface CategoryBarProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function CategoryBar({
  categories,
  selectedId,
  onSelect,
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
