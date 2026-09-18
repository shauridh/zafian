"use client";

import React, { useCallback, useRef } from "react";
import clsx from "clsx";

interface NumpadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  /** Replaces an initial prefilled value when the first digit is pressed. */
  replaceOnFirstDigit?: boolean;
  showQuickAmounts?: boolean;
  quickAmounts?: { label: string; value: number }[];
}

export default function Numpad({
  value,
  onChange,
  maxLength = 15,
  replaceOnFirstDigit = false,
  showQuickAmounts = false,
  quickAmounts = [],
}: NumpadProps) {
  const lastInputType = useRef<"initial" | "quick" | "numpad" | null>(replaceOnFirstDigit ? "initial" : null);

  const handleQuickAmount = useCallback(
    (amount: number) => {
      lastInputType.current = "quick";
      onChange(String(amount));
    },
    [onChange]
  );

  const handlePress = useCallback(
    (digit: string) => {
      if (digit === "backspace") {
        lastInputType.current = "numpad";
        onChange(value.slice(0, -1));
        return;
      }
      if (digit === "clear") {
        lastInputType.current = null;
        onChange("");
        return;
      }
      if (value.length >= maxLength) return;
      if (!/^\d+$/.test(digit)) return;

      if (lastInputType.current === "initial" || lastInputType.current === "quick") {
        lastInputType.current = "numpad";
        onChange(digit);
        return;
      }

      lastInputType.current = "numpad";
      onChange(value + digit);
    },
    [value, maxLength, onChange]
  );

  const buttons = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["clear", "0", "backspace"],
  ];

  return (
    <div className="space-y-2">
      {/* Quick amount buttons */}
      {showQuickAmounts && (
        <div className="flex flex-wrap gap-1.5">
          {quickAmounts.map((qa) => {
            const isActive = value === String(qa.value);
            return (
              <button
                key={qa.label}
                onClick={() => handleQuickAmount(qa.value)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold transition-all duration-150",
                  "active:scale-95 cursor-pointer",
                  isActive
                    ? "bg-sabana text-white shadow-md"
                    : "bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-300 hover:bg-sabana hover:text-white"
                )}
              >
                {qa.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Numpad grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {buttons.map((row, rowIdx) =>
          row.map((digit) => (
            <button
              key={`${rowIdx}-${digit}`}
              onClick={() => handlePress(digit)}
              className={clsx(
                "numpad-btn",
                digit === "clear" && "bg-gray-100 dark:bg-[#333] text-danger text-sm sm:text-lg",
                digit === "backspace" && "bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400 text-sm sm:text-lg",
                digit !== "clear" &&
                  digit !== "backspace" &&
                  "bg-white dark:bg-[#262626] text-gray-900 dark:text-gray-100 hover:bg-sabana-50 dark:hover:bg-sabana/10 border border-gray-200 dark:border-[#444]",
                "shadow-sm hover:shadow-md"
              )}
            >
              {digit === "backspace" ? (
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                </svg>
              ) : digit === "clear" ? (
                "C"
              ) : (
                digit
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
