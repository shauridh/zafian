"use client";

import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { useShiftStore } from "@/stores/shiftStore";

interface Props {
  isOnline: boolean;
  dataReady: boolean;
  onOpenCashInOut: () => void;
  onOpenRecentOrders: () => void;
  showCashInOut: boolean;
  showSearch: boolean;
  onToggleSearch: () => void;
}

/** Compact POS top bar: logo, status, cashier actions. */
export default function POSHeader({ isOnline, dataReady, onOpenCashInOut, onOpenRecentOrders, showCashInOut, showSearch, onToggleSearch }: Props) {
  const router = useRouter();
  const { isShiftOpen, cashierName } = useShiftStore();

  return (
    <header className="bg-white dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-[#333] px-2 sm:px-3 py-1.5 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span className="text-lg sm:text-xl">🍗</span>
        <h1 className="font-heading font-bold text-sm sm:text-lg text-sabana hidden sm:block">SABANA POS</h1>
        {!dataReady && (
          <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium animate-pulse">Syncing...</span>
        )}
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        <div className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isOnline ? "bg-success animate-pulse" : "bg-danger"}`} />
          <span className={`text-[10px] sm:text-xs font-medium hidden sm:block ${isOnline ? "text-gray-600 dark:text-gray-400" : "text-danger"}`}>{isOnline ? "Online" : "Offline"}</span>
        </div>
        <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 hidden md:block">{new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
        {showCashInOut && (
          <button onClick={onOpenCashInOut} className="p-1.5 sm:p-2 rounded-lg bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-700 dark:text-green-400 transition-colors" title="Cash In/Out">💰</button>
        )}
        <button onClick={onOpenRecentOrders} className="p-1.5 sm:p-2 rounded-lg bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#444] text-gray-600 dark:text-gray-400 transition-colors" title="Order Hari Ini">📋</button>
        <button onClick={onToggleSearch} className={`p-1.5 sm:p-2 rounded-lg transition-colors ${showSearch ? "bg-sabana-50 dark:bg-sabana/10 text-sabana" : "bg-gray-100 dark:bg-[#333] text-gray-500"}`} title={showSearch ? "Sembunyikan pencarian" : "Tampilkan pencarian"} aria-label={showSearch ? "Sembunyikan pencarian" : "Tampilkan pencarian"}>⌕</button>
        <ThemeToggle />
        <div className="flex items-center gap-1 bg-sabana-50 dark:bg-sabana/10 px-1.5 py-0.5 rounded-lg">
          <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-sabana text-white flex items-center justify-center text-[10px] sm:text-xs font-bold">{cashierName?.charAt(0) || "K"}</div>
          <span className="text-[10px] sm:text-xs font-medium text-gray-700 dark:text-gray-300 hidden sm:block">{cashierName || "Kasir"}</span>
        </div>
        {isShiftOpen && (
          <button onClick={() => router.push("/kasir/shift/close")} className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-green-50 hover:bg-red-50 text-green-700 hover:text-danger transition-colors border border-green-200 hover:border-red-200" title="Tutup Shift">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] font-medium hidden md:block">Shift Aktif</span>
          </button>
        )}
        <button onClick={() => router.push("/admin/dashboard")} className="p-1.5 sm:p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors" title="Admin Panel">
          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>
        <button onClick={() => router.push("/login")} className="p-1.5 sm:p-2 rounded-lg bg-red-50 hover:bg-red-100 text-danger transition-colors" title="Keluar">
          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        </button>
      </div>
    </header>
  );
}
