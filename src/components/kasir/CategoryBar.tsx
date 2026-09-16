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
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {/* Semua button */}
      <button
        onClick={() => onSelect(null)}
        className={clsx(
          "flex flex-col items-center gap-1 px-4 py-3 rounded-xl transition-all duration-200",
          "min-w-[80px] cursor-pointer whitespace-nowrap",
          selectedId === null
            ? "bg-sabana text-white shadow-lg shadow-sabana/30"
            : "bg-white text-gray-700 hover:bg-sabana-50 border border-gray-200"
        )}
      >
        <span className="text-2xl">📋</span>
        <span className="text-xs font-semibold">Semua</span>
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={clsx(
            "flex flex-col items-center gap-1 px-4 py-3 rounded-xl transition-all duration-200",
            "min-w-[80px] cursor-pointer whitespace-nowrap",
            selectedId === cat.id
              ? "bg-sabana text-white shadow-lg shadow-sabana/30"
              : "bg-white text-gray-700 hover:bg-sabana-50 border border-gray-200"
          )}
        >
          <span className="text-2xl">{cat.icon}</span>
          <span className="text-xs font-semibold">{cat.name}</span>
        </button>
      ))}
    </div>
  );
}
