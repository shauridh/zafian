"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: "📊" },
    ],
  },
  {
    label: "Produk",
    items: [
      { href: "/admin/products", label: "Produk", icon: "🍗" },
      { href: "/admin/bundles", label: "Paket/Bundling", icon: "🎁" },
    ],
  },
  {
    label: "Menu & Resep",
    items: [
      { href: "/admin/menu", label: "Kategori", icon: "📋" },
      { href: "/admin/ingredients", label: "Bahan Baku", icon: "📦" },
      { href: "/admin/recipes", label: "Resep / BOM", icon: "🧾" },
    ],
  },
  {
    label: "Operasional",
    items: [
      { href: "/admin/production", label: "Produksi", icon: "🏭" },
      { href: "/admin/stock", label: "Stok", icon: "📊" },
      { href: "/admin/stock-opname", label: "Stock Opname", icon: "📋" },
      { href: "/admin/shifts", label: "Riwayat Shift", icon: "🔄" },
    ],
  },
  {
    label: "Keuangan",
    items: [
      { href: "/admin/finance", label: "Cashflow", icon: "💰" },
      { href: "/admin/reports", label: "Laporan", icon: "📈" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/promos", label: "Promo & Diskon", icon: "🏷️" },
      { href: "/admin/loyalty", label: "Loyalty Program", icon: "⭐" },
      { href: "/admin/forecasts", label: "Forecasting", icon: "📈" },
      { href: "/admin/reorder", label: "Reorder Bahan", icon: "🛒" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/users", label: "Users", icon: "👥" },
      { href: "/admin/audit", label: "Audit Log", icon: "📋" },
      { href: "/admin/settings", label: "Pengaturan", icon: "⚙️" },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-[100dvh] bg-cream dark:bg-[#0f0f0f]">
      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 bg-white dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-[#333] flex flex-col transition-all duration-300 md:static md:z-auto",
          sidebarOpen ? "w-64" : "w-16",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-[#333] flex items-center justify-center hover:bg-gray-200 dark:hover:bg-[#444] transition-colors"
          >
            {sidebarOpen ? "◀" : "▶"}
          </button>
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <span className="text-xl">🍗</span>
              <span className="font-heading font-bold text-sabana dark:text-sabana-light">SABANA</span>
            </div>
          )}
        </div>

        {/* Nav Items grouped by section */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-2">
              {sidebarOpen && (
                <p className="px-5 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileSidebarOpen(false)}
                    className={clsx(
                      "flex items-center gap-3 px-4 py-2 mx-2 rounded-lg transition-all duration-200",
                      "hover:bg-sabana-50 dark:hover:bg-sabana/10",
                      isActive
                        ? "bg-sabana text-white font-semibold shadow-md"
                        : "text-gray-600 dark:text-gray-400"
                    )}
                  >
                    <span className="text-lg shrink-0">{item.icon}</span>
                    {sidebarOpen && (
                      <span className="text-xs whitespace-nowrap">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Back to POS */}
        <div className="p-2 border-t border-gray-200">
          <Link
            href="/kasir"
            onClick={() => setMobileSidebarOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-sabana-50 dark:hover:bg-sabana/10 text-gray-600 dark:text-gray-400 transition-colors"
          >
            <span className="text-lg">🛒</span>
            {sidebarOpen && <span className="text-sm">Kembali ke POS</span>}
          </Link>
        </div>
      </aside>

      {mobileSidebarOpen && <button type="button" aria-label="Tutup menu admin" onClick={() => setMobileSidebarOpen(false)} className="fixed inset-0 z-40 bg-black/40 md:hidden" />}

      {/* Main Content */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-cream/95 px-4 py-2 backdrop-blur dark:border-[#333] dark:bg-[#0f0f0f]/95 md:hidden">
          <button type="button" aria-label="Buka menu admin" onClick={() => setMobileSidebarOpen(true)} className="min-h-11 min-w-11 rounded-xl bg-white text-lg shadow-sm dark:bg-[#1a1a1a]">☰</button>
          <span className="font-heading text-sm font-bold text-sabana">SABANA ADMIN</span>
        </div>
        {children}
      </main>
    </div>
  );
}
