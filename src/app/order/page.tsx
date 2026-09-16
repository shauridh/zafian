"use client";

import React, { useState } from "react";
import { formatRupiah } from "@/lib/format";

const CATEGORIES = [
  { id: "all", name: "Semua", icon: "📋" },
  { id: "chicken", name: "Ayam Goreng", icon: "🍗" },
  { id: "rice", name: "Nasi", icon: "🍚" },
  { id: "bowl", name: "Rice Bowl", icon: "🍱" },
  { id: "sauce", name: "Sambal", icon: "🥘" },
  { id: "side", name: "Side Menu", icon: "🍢" },
  { id: "drink", name: "Minuman", icon: "🥤" },
  { id: "bundle", name: "Paket Hemat", icon: "📦" },
];

const MENU_ITEMS = [
  { id: "1", name: "Ayam Reguler (9 potong)", price: 89000, cat: "chicken", desc: "9 potong ayam goreng renyah" },
  { id: "2", name: "Nasi Putih", price: 5000, cat: "rice", desc: "Nasi putih hangat" },
  { id: "3", name: "RB Sambal Geprek 650ml", price: 15000, cat: "bowl", desc: "Ayam + nasi + sambal geprek" },
  { id: "4", name: "RB BBQ 650ml", price: 15000, cat: "bowl", desc: "Ayam + nasi + BBQ sauce" },
  { id: "5", name: "Kentang Goreng", price: 8000, cat: "side", desc: "Kentang goreng renyah" },
  { id: "6", "name": "Sambal Geprek", price: 4000, cat: "sauce", desc: "Sambal geprek pedas" },
  { id: "7", name: "Fruit Tea Apple", price: 3000, cat: "drink", desc: "Minuman buah apel 250ml" },
  { id: "8", name: "Paket Komplit", price: 115000, cat: "bundle", desc: "Ayam + Nasi + Kentang + Minuman", discount: "HEMAT 12%" },
  { id: "9", name: "Paket Nasi Ayam", price: 95000, cat: "bundle", desc: "Ayam + Nasi + Sambal", discount: "HEMAT 10%" },
  { id: "10", name: "Chicken Bun", price: 10000, cat: "side", desc: "Roti bun dengan ayam" },
  { id: "11", name: "Burger", price: 12000, cat: "side", desc: "Burger dengan ayam patty" },
  { id: "12", name: "Chicken Katsu", price: 8000, cat: "side", desc: "Chicken katsu goreng" },
];

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
}

export default function OrderPage() {
  const [selectedCat, setSelectedCat] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  const filteredItems =
    selectedCat === "all"
      ? MENU_ITEMS
      : MENU_ITEMS.filter((item) => item.cat === selectedCat);

  const addToCart = (item: (typeof MENU_ITEMS)[0]) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) => (c.id === item.id ? { ...c, qty: c.qty + 1 } : c));
      }
      return [...prev, { id: item.id, name: item.name, price: item.price, qty: 1 }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((c) => c.id !== id));
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0)
    );
  };

  const totalItems = cart.reduce((sum, c) => sum + c.qty, 0);
  const totalPrice = cart.reduce((sum, c) => sum + c.price * c.qty, 0);

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="bg-sabana text-white px-4 py-4 sticky top-0 z-10 shadow-lg">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍗</span>
            <div>
              <h1 className="font-heading font-bold text-lg">SABANA</h1>
              <p className="text-xs text-sabana-200">Fried Chicken</p>
            </div>
          </div>
          <button
            onClick={() => setShowCart(!showCart)}
            className="relative p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-danger text-white text-xs font-bold rounded-full flex items-center justify-center">
                {totalItems}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Promo Banner */}
      <div className="bg-gradient-to-r from-sabana to-sabana-dark text-white p-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-sm font-medium">🎉 GRATIS ONGKIR</p>
          <h2 className="text-xl font-heading font-bold">Order Langsung dari Sabana!</h2>
          <p className="text-sabana-200 text-sm mt-1">Hemat hingga 30% dibanding GoFood/GrabFood</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Category Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCat(cat.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                selectedCat === cat.id
                  ? "bg-sabana text-white shadow-lg"
                  : "bg-white text-gray-600 border border-gray-200"
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>

        {/* Menu Items */}
        <div className="space-y-3 pb-24">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex gap-4"
            >
              <div className="w-20 h-20 bg-sabana-50 rounded-xl flex items-center justify-center text-3xl flex-shrink-0">
                {item.cat === "chicken" ? "🍗" : item.cat === "rice" ? "🍚" : item.cat === "bowl" ? "🍱" : item.cat === "sauce" ? "🥘" : item.cat === "drink" ? "🥤" : item.cat === "bundle" ? "📦" : "🍢"}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900">{item.name}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{item.desc}</p>
                <div className="flex items-center justify-between mt-2">
                  <div>
                    <span className="text-sabana font-bold text-lg">{formatRupiah(item.price)}</span>
                    {item.discount && (
                      <span className="ml-2 text-xs font-bold text-danger bg-red-100 px-2 py-0.5 rounded-full">
                        {item.discount}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => addToCart(item)}
                    className="w-10 h-10 rounded-full bg-sabana text-white flex items-center justify-center text-xl
                               hover:bg-sabana-dark active:scale-95 transition-all shadow-md"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cart Drawer */}
      {showCart && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCart(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl animate-slide-up">
            <div className="flex flex-col h-full">
              <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="font-heading font-bold text-lg">🛒 Keranjang</h2>
                <button onClick={() => setShowCart(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {cart.length === 0 ? (
                  <div className="text-center text-gray-400 py-12">
                    <p className="text-4xl mb-2">🛒</p>
                    <p>Keranjang kosong</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                      <div className="flex-1">
                        <h4 className="font-medium text-sm">{item.name}</h4>
                        <p className="text-sabana font-bold text-sm">{formatRupiah(item.price)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateQty(item.id, -1)}
                          className="w-8 h-8 rounded-lg bg-white border flex items-center justify-center"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-bold">{item.qty}</span>
                        <button
                          onClick={() => updateQty(item.id, 1)}
                          className="w-8 h-8 rounded-lg bg-white border flex items-center justify-center"
                        >
                          +
                        </button>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="p-2 text-gray-400 hover:text-danger"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>

              {cart.length > 0 && (
                <div className="border-t border-gray-200 p-4 space-y-3">
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span className="text-sabana">{formatRupiah(totalPrice)}</span>
                  </div>
                  <button
                    onClick={() => {
                      setShowCart(false);
                      setShowCheckout(true);
                    }}
                    className="w-full py-4 bg-sabana text-white rounded-xl font-bold text-lg hover:bg-sabana-dark transition-colors shadow-lg"
                  >
                    Checkout →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {showCheckout && (
        <div className="fixed inset-0 z-40 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCheckout(false)} />
          <div className="relative bg-white rounded-t-3xl w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
            <h2 className="font-heading font-bold text-xl mb-4">📦 Checkout</h2>

            {/* Order Summary */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4">
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between text-sm mb-1">
                  <span>{item.qty}x {item.name}</span>
                  <span className="font-medium">{formatRupiah(item.price * item.qty)}</span>
                </div>
              ))}
              <div className="border-t mt-2 pt-2 flex justify-between font-bold">
                <span>Total</span>
                <span className="text-sabana">{formatRupiah(totalPrice)}</span>
              </div>
            </div>

            {/* Delivery Form */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Nama</label>
                <input
                  type="text"
                  placeholder="Nama lengkap"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">No. WhatsApp</label>
                <input
                  type="tel"
                  placeholder="08xxx"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Alamat Delivery</label>
                <textarea
                  placeholder="Alamat lengkap..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Catatan</label>
                <input
                  type="text"
                  placeholder="Opsional..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana"
                />
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2">Metode Bayar</label>
                <div className="flex gap-3">
                  <button className="flex-1 py-3 rounded-xl border-2 border-sabana bg-sabana-50 font-semibold text-sabana">
                    💵 Tunai
                  </button>
                  <button className="flex-1 py-3 rounded-xl border-2 border-gray-200 font-semibold text-gray-600">
                    📱 QRIS
                  </button>
                </div>
              </div>
            </div>

            {/* Submit */}
            <button className="w-full py-4 bg-sabana text-white rounded-xl font-bold text-lg hover:bg-sabana-dark transition-colors shadow-lg">
              ✅ Pesan Sekarang
            </button>

            <button
              onClick={() => setShowCheckout(false)}
              className="w-full py-3 mt-2 text-gray-500 font-medium hover:text-gray-700"
            >
              Kembali ke Menu
            </button>
          </div>
        </div>
      )}

      {/* Floating Cart Button */}
      {totalItems > 0 && !showCart && (
        <div className="fixed bottom-4 left-4 right-4 z-20 max-w-2xl mx-auto">
          <button
            onClick={() => setShowCart(true)}
            className="w-full py-4 bg-sabana text-white rounded-2xl font-bold text-lg 
                       flex items-center justify-between px-6 shadow-xl shadow-sabana/30
                       hover:bg-sabana-dark transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                {totalItems}
              </span>
              <span>Lihat Keranjang</span>
            </div>
            <span>{formatRupiah(totalPrice)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
