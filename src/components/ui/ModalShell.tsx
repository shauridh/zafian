"use client";

import { ReactNode, useEffect } from "react";

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  dismissible?: boolean;
}

export default function ModalShell({
  open,
  onClose,
  children,
  className = "max-w-md",
  labelledBy,
  dismissible = true,
}: ModalShellProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, dismissible]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button type="button" aria-label="Tutup modal" className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={dismissible ? onClose : undefined} />
      <div className={`relative z-10 w-full ${className} max-h-[calc(100vh-24px)] overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#1a1a1a] sm:max-h-[calc(100vh-32px)]`}>
        {children}
      </div>
    </div>
  );
}
