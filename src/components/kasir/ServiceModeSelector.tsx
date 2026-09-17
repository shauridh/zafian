"use client";

import React from "react";
import clsx from "clsx";
import { SERVICE_MODE_LABELS, SERVICE_MODE_COLORS } from "@/lib/format";

interface ServiceModeSelectorProps {
  selected: string;
  onSelect: (mode: string) => void;
  excludeModes?: string[];
}

const SERVICE_MODES = [
  { id: "dine_in", icon: "🍽️" },
  { id: "take_away", icon: "📦" },
  { id: "gofood", icon: "🛵" },
  { id: "grabfood", icon: "🚚" },
  { id: "shopeefood", icon: "🛒" },
];

export default function ServiceModeSelector({
  selected,
  onSelect,
  excludeModes = [],
}: ServiceModeSelectorProps) {
  const modes = SERVICE_MODES.filter((m) => !excludeModes.includes(m.id));

  return (
    <div className="flex flex-wrap gap-2">
      {modes.map((mode) => {
        const isActive = selected === mode.id;
        const color = SERVICE_MODE_COLORS[mode.id];

        return (
          <button
            key={mode.id}
            onClick={() => onSelect(mode.id)}
            className={clsx(
              "service-btn flex items-center gap-2",
              isActive ? "text-white shadow-lg" : "bg-white dark:bg-[#1e1e1e] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#333] hover:border-gray-300 dark:hover:border-[#444]"
            )}
            style={
              isActive
                ? { backgroundColor: color, borderColor: color }
                : undefined
            }
          >
            <span>{mode.icon}</span>
            <span>{SERVICE_MODE_LABELS[mode.id]}</span>
          </button>
        );
      })}
    </div>
  );
}
