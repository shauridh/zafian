"use client";

import React from "react";
import clsx from "clsx";
import { useCartStore } from "@/stores/cartStore";
import { formatRupiah } from "@/lib/format";

interface CartProps {
  onCheckout: () => void;
}

export default function Cart({ onCheckout }: CartProps) {
  const {
    items,
    removeItem,
    updateQuantity,
    clearCart,
    getSubtotal,
    getDiscountAmount,
    getTotal,
    getItemCount,
  } = useCartStore();

  const subtotal = getSubtotal();
  const discount = getDiscountAmount();
  const total = getTotal();
  const itemCount = getItemCount();

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-[#333] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-2.5 py-1.5 bg-sabana text-white shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold text-xs sm:text-sm flex items-center gap-1">🛒 Keranjang</h2>
          <span className="text-sabana-200 text-[10px]">{itemCount} item</span>
        </div>
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 py-6">
            <span className="text-2xl mb-1">🛒</span>
            <p className="text-[10px] font-medium">Keranjang kosong</p>
            <p className="text-[9px]">Tap produk untuk menambahkan</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="cart-item-enter bg-gray-50 dark:bg-[#222] rounded-lg p-1.5">
              <div className="flex items-start justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-[10px] sm:text-xs text-gray-900 dark:text-gray-200 truncate leading-tight">{item.name}</h4>
                  <p className="text-sabana font-bold text-[10px] sm:text-xs">{formatRupiah(item.price)}</p>
                </div>
                <button onClick={() => removeItem(item.id)} className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-danger transition-colors shrink-0">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-6 h-6 rounded bg-white dark:bg-[#333] border border-gray-200 dark:border-[#444] flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-sabana hover:text-white hover:border-sabana active:scale-90 transition-all text-[10px] font-bold">−</button>
                  <span className="w-5 text-center font-bold text-[10px] sm:text-xs text-gray-900 dark:text-gray-200">{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-6 h-6 rounded bg-white dark:bg-[#333] border border-gray-200 dark:border-[#444] flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-sabana hover:text-white hover:border-sabana active:scale-90 transition-all text-[10px] font-bold">+</button>
                </div>
                <span className="font-bold text-[10px] sm:text-xs text-gray-900 dark:text-gray-200">{formatRupiah(item.price * item.quantity)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {items.length > 0 && (
        <div className="border-t border-gray-200 dark:border-[#333] p-2 space-y-1 shrink-0">
          <div className="flex justify-between text-[10px]">
            <span className="text-gray-500">Subtotal</span>
            <span className="font-medium">{formatRupiah(subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-[10px]">
              <span className="text-success">Diskon</span>
              <span className="font-medium text-success">-{formatRupiah(discount)}</span>
            </div>
          )}
          <div className="border-t border-gray-200 dark:border-[#333] pt-1">
            <div className="flex justify-between">
              <span className="text-xs font-heading font-bold">TOTAL</span>
              <span className="text-sm font-heading font-bold text-sabana">{formatRupiah(total)}</span>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button onClick={clearCart} className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#222] active:scale-95 transition-all text-[10px] font-semibold">🗑️</button>
            <button onClick={onCheckout} className="flex-1 px-3 py-1.5 rounded-lg bg-sabana text-white font-bold hover:bg-sabana-dark active:scale-95 transition-all shadow-md shadow-sabana/30 text-xs">💳 BAYAR</button>
          </div>
        </div>
      )}
    </div>
  );
}
