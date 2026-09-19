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
  { id: "dine_in", label: "Dine In", kind: "plain" },
  { id: "take_away", label: "Take Away", kind: "plain" },
  { id: "gofood", label: "GoFood", kind: "gofood" },
  { id: "grabfood", label: "GrabFood", kind: "grabfood" },
  { id: "shopeefood", label: "ShopeeFood", kind: "shopeefood" },
] as const;

function BrandMark({ kind }: { kind: (typeof SERVICE_MODES)[number]["kind"] }) {
  if (kind === "gofood") return <span className="font-black tracking-tight text-[#00AA13]">gofood</span>;
  if (kind === "grabfood") return <span className="font-black tracking-tight text-[#00B14F]">GrabFood</span>;
  if (kind === "shopeefood") return <span className="font-black tracking-tight text-[#EE4D2D]">ShopeeFood</span>;
  return null;
}

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
              isActive ? "!text-white shadow-lg" : "bg-white dark:bg-[#1e1e1e] text-gray-700 dark:text-gray-200 border-gray-200 dark:border-[#333] hover:border-gray-300 dark:hover:border-[#444]"
            )}
            style={
              isActive
                ? { backgroundColor: color, borderColor: color }
                : undefined
            }
          >
            {mode.kind === "plain" ? <span>{mode.label}</span> : <BrandMark kind={mode.kind} />}
          </button>
        );
      })}
    </div>
  );
}
