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
    <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-sabana text-white shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold text-sm flex items-center gap-1.5">
            🛒 Keranjang
          </h2>
          <span className="text-sabana-200 text-xs">{itemCount} item</span>
        </div>
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 py-8">
            <span className="text-3xl mb-2">🛒</span>
            <p className="text-xs font-medium">Keranjang kosong</p>
            <p className="text-[10px]">Tap produk untuk menambahkan</p>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="cart-item-enter bg-gray-50 rounded-lg p-2"
            >
              <div className="flex items-start justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-xs text-gray-900 truncate leading-tight">
                    {item.name}
                  </h4>
                  <p className="text-sabana font-bold text-xs">
                    {formatRupiah(item.price)}
                  </p>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-danger transition-colors shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Quantity Controls */}
              <div className="flex items-center justify-between mt-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    className="w-7 h-7 rounded-md bg-white border border-gray-200 flex items-center justify-center
                               text-gray-600 hover:bg-sabana hover:text-white hover:border-sabana
                               active:scale-90 transition-all text-sm cursor-pointer"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-bold text-sm text-gray-900">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    className="w-7 h-7 rounded-md bg-white border border-gray-200 flex items-center justify-center
                               text-gray-600 hover:bg-sabana hover:text-white hover:border-sabana
                               active:scale-90 transition-all text-sm cursor-pointer"
                  >
                    +
                  </button>
                </div>
                <span className="font-bold text-xs text-gray-900">
                  {formatRupiah(item.price * item.quantity)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer - Totals */}
      {items.length > 0 && (
        <div className="border-t border-gray-200 p-3 space-y-1.5 shrink-0">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Subtotal</span>
            <span className="font-medium">{formatRupiah(subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-success">Diskon</span>
              <span className="font-medium text-success">-{formatRupiah(discount)}</span>
            </div>
          )}
          <div className="border-t border-gray-200 pt-1.5">
            <div className="flex justify-between">
              <span className="text-sm font-heading font-bold">TOTAL</span>
              <span className="text-base font-heading font-bold text-sabana">
                {formatRupiah(total)}
              </span>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={clearCart}
              className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 
                         hover:bg-gray-50 active:scale-95 transition-all text-xs font-semibold"
            >
              🗑️
            </button>
            <button
              onClick={onCheckout}
              className="flex-1 px-4 py-2 rounded-lg bg-sabana text-white font-bold
                         hover:bg-sabana-dark active:scale-95 transition-all shadow-md
                         shadow-sabana/30 text-sm"
            >
              💳 BAYAR
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
