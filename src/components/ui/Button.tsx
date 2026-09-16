"use client";

import React from "react";
import clsx from "clsx";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "success" | "danger" | "warning" | "ghost" | "outline";
  size?: "sm" | "md" | "lg" | "xl";
  fullWidth?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

export default function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-150",
        "active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
        "focus:outline-none focus:ring-2 focus:ring-offset-2",
        {
          // Variants
          "bg-sabana text-white hover:bg-sabana-dark focus:ring-sabana shadow-md hover:shadow-lg":
            variant === "primary",
          "bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-300":
            variant === "secondary",
          "bg-success text-white hover:bg-green-700 focus:ring-success shadow-md":
            variant === "success",
          "bg-danger text-white hover:bg-red-700 focus:ring-danger shadow-md":
            variant === "danger",
          "bg-warning text-gray-900 hover:bg-yellow-400 focus:ring-warning":
            variant === "warning",
          "bg-transparent text-gray-600 hover:bg-gray-100 focus:ring-gray-300":
            variant === "ghost",
          "border-2 border-gray-300 text-gray-700 hover:border-sabana hover:text-sabana focus:ring-sabana":
            variant === "outline",
          // Sizes
          "text-xs px-3 py-1.5 min-h-[32px]": size === "sm",
          "text-sm px-4 py-2 min-h-[40px]": size === "md",
          "text-base px-6 py-3 min-h-[48px]": size === "lg",
          "text-lg px-8 py-4 min-h-[56px]": size === "xl",
          // Full width
          "w-full": fullWidth,
        },
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
