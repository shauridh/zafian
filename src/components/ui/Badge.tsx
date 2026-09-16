"use client";

import React from "react";
import clsx from "clsx";

interface BadgeProps {
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  dot?: boolean;
  children: React.ReactNode;
}

export default function Badge({
  variant = "default",
  size = "md",
  dot = false,
  children,
}: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 font-medium rounded-full",
        {
          "bg-gray-100 text-gray-700": variant === "default",
          "bg-sabana-100 text-sabana-700": variant === "primary",
          "bg-green-100 text-green-700": variant === "success",
          "bg-yellow-100 text-yellow-700": variant === "warning",
          "bg-red-100 text-red-700": variant === "danger",
          "border border-gray-300 text-gray-600": variant === "outline",
          "text-xs px-2 py-0.5": size === "sm",
          "text-sm px-2.5 py-0.5": size === "md",
          "text-base px-3 py-1": size === "lg",
        }
      )}
    >
      {dot && (
        <span
          className={clsx("w-2 h-2 rounded-full", {
            "bg-gray-400": variant === "default",
            "bg-sabana": variant === "primary",
            "bg-green-500": variant === "success",
            "bg-yellow-500": variant === "warning",
            "bg-red-500": variant === "danger",
          })}
        />
      )}
      {children}
    </span>
  );
}
