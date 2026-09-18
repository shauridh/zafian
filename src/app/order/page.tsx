"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import ModalShell from "@/components/ui/ModalShell";

type Product = {
  id: string;
  name: string;
  price: number;
  category_id: string;
  description?: string;
  image_url?: string;
  is_available: boolean;
  categories?: { name: string; icon: string };
};

type Category = {
  id: string;
  name: string;
  icon: string;
};

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
  image_url?: string;
}

export default function OrderPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCat, setSelectedCat] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qris">("cash");

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [catResult, prodResult] = await Promise.all([
        supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("products").select("*, categories(name, icon)").eq("is_active", true).eq("is_available", true).order("name"),
      ]);
      if (catResult.data) setCategories(catResult.data);
      if (prodResult.data) setProducts(prodResult.data as any);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredProducts = selectedCat === "all" ? products : products.filter((p) => p.category_id === selectedCat);

  const getCategoryIcon = (catId: string) => categories.find((c) => c.id === catId)?.icon || "🍗";

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === product.id);
      if (existing) return prev.map((c) => (c.id === product.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { id: product.id, name: product.name, price: product.price, qty: 1, image_url: product.image_url }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty: c.qty + delta } : c)).filter((c) => c.qty > 0));
  };

  const removeFromCart = (id: string) => setCart((prev) => prev.filter((c) => c.id !== id));

  const totalItems = cart.reduce((sum, c) => sum + c.qty, 0);
  const totalPrice = cart.reduce((sum, c) => sum + c.price * c.qty, 0);

  const handleOrder = async () => {
    if (!customerName || !customerPhone) return alert("Nama dan No. HP wajib diisi!");
    setSubmitting(true);
    try {
      const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;
      const { data: order, error } = await supabase.from("orders").insert({
        order_number_text: orderNumber,
        customer_name: customerName,
        phone: customerPhone,
        delivery_address: deliveryAddress,
        notes,
        total: totalPrice,
        final_total: totalPrice,
        payment_method: paymentMethod,
        order_source: "customer_portal",
        status: "pending",
        outlet_id: "00000000-0000-0000-0000-000000000001",
      }).select().single();

      if (error) throw error;

      // Insert order items
      const orderItems = cart.map((item) => ({
        order_id: order.id,
        product_id: item.id,
        name: item.name,
        quantity: item.qty,
        unit_price: item.price,
        subtotal: item.price * item.qty,
      }));
      await supabase.from("order_items").insert(orderItems);

      setOrderSuccess(true);
      setCart([]);
      setShowCheckout(false);
      setTimeout(() => setOrderSuccess(false), 5000);
    } catch (err: any) {
      alert("Gagal membuat order: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Success overlay
  if (orderSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sabana via-sabana-dark to-sabana-darker flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-4xl">✅</span>
          </div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-2">Order Berhasil!</h2>
          <p className="text-gray-500 mb-4">Pesanan kamu sedang diproses. Kasir akan segera memprosesnya.</p>
          <button onClick={() => setOrderSuccess(false)} className="w-full py-3 bg-sabana text-white rounded-xl font-bold hover:bg-sabana-dark transition-colors">
            Kembali ke Menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0f0f0f]">
      {/* Header */}
      <header className="bg-sabana text-white px-4 py-4 sticky top-0 z-30 shadow-lg">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-md">
              <span className="text-2xl">🍗</span>
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg">SABANA</h1>
              <p className="text-xs text-white/70">Fried Chicken</p>
            </div>
          </div>
          <button onClick={() => setShowCart(true)} className="relative p-2.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-danger text-white text-xs font-bold rounded-full flex items-center justify-center animate-bounce">
                {totalItems}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Promo Banner */}
      <div className="bg-gradient-to-r from-sabana-dark to-sabana-darker text-white p-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-sm font-medium text-white/80">🎉 GRATIS ONGKIR</p>
          <h2 className="text-xl font-heading font-bold">Order Langsung dari Sabana!</h2>
          <p className="text-white/60 text-sm mt-1">Hemat hingga 30% dibanding GoFood/GrabFood</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Category Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-hide">
          <button onClick={() => setSelectedCat("all")} className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all shadow-sm ${selectedCat === "all" ? "bg-sabana text-white" : "bg-white dark:bg-[#1a1a1a] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-[#333]"}`}>
            📋 Semua
          </button>
          {categories.map((cat) => (
            <button key={cat.id} onClick={() => setSelectedCat(cat.id)} className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all shadow-sm ${selectedCat === cat.id ? "bg-sabana text-white" : "bg-white dark:bg-[#1a1a1a] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-[#333]"}`}>
              {cat.icon} {cat.name}
            </button>
          ))}
        </div>

        {/* Product Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-10 h-10 border-2 border-sabana border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-400 dark:text-gray-500 text-sm">Memuat menu...</p>
            </div>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            <p className="text-4xl mb-2">🍽️</p>
            <p>Menu tidak tersedia</p>
          </div>
        ) : (
          <div className="space-y-3 pb-24">
            {filteredProducts.map((product) => (
              <div key={product.id} className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-4 border border-gray-100 dark:border-[#333] shadow-sm flex gap-4 hover:shadow-md transition-shadow">
                <div className="w-20 h-20 bg-sabana-50 dark:bg-sabana/10 rounded-xl flex items-center justify-center text-3xl flex-shrink-0">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="w-full h-full object-cover rounded-xl" />
                  ) : (
                    getCategoryIcon(product.category_id)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">{product.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{product.description || product.categories?.name || ""}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sabana font-bold text-lg">{formatRupiah(product.price)}</span>
                    <button onClick={() => addToCart(product)} className="w-10 h-10 rounded-full bg-sabana text-white flex items-center justify-center text-xl hover:bg-sabana-dark active:scale-95 transition-all shadow-md">
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cart Drawer */}
      {showCart && (
        <ModalShell open={showCart} onClose={() => setShowCart(false)} className="h-[min(680px,calc(100vh-32px))] max-w-md">
            <div className="flex h-full flex-col">
              <div className="px-4 py-4 border-b border-gray-200 dark:border-[#333] flex items-center justify-between">
                <h2 className="font-heading font-bold text-lg dark:text-gray-100">🛒 Keranjang ({totalItems})</h2>
                <button onClick={() => setShowCart(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg text-gray-400">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {cart.length === 0 ? (
                  <div className="text-center text-gray-400 dark:text-gray-500 py-12">
                    <p className="text-4xl mb-2">🛒</p>
                    <p>Keranjang kosong</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 bg-gray-50 dark:bg-[#222] rounded-xl p-3">
                      <div className="w-12 h-12 bg-sabana-50 dark:bg-sabana/10 rounded-lg flex items-center justify-center text-xl flex-shrink-0">
                        🍗
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">{item.name}</h4>
                        <p className="text-sabana font-bold text-sm">{formatRupiah(item.price)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQty(item.id, -1)} className="w-8 h-8 rounded-lg bg-white dark:bg-[#333] border border-gray-200 dark:border-[#444] flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#444]">−</button>
                        <span className="w-6 text-center font-bold text-gray-800 dark:text-gray-200">{item.qty}</span>
                        <button onClick={() => updateQty(item.id, 1)} className="w-8 h-8 rounded-lg bg-white dark:bg-[#333] border border-gray-200 dark:border-[#444] flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#444]">+</button>
                      </div>
                      <button onClick={() => removeFromCart(item.id)} className="p-2 text-gray-400 hover:text-danger">✕</button>
                    </div>
                  ))
                )}
              </div>
              {cart.length > 0 && (
                <div className="border-t border-gray-200 dark:border-[#333] p-4 space-y-3">
                  <div className="flex justify-between text-lg font-bold">
                    <span className="text-gray-800 dark:text-gray-200">Total</span>
                    <span className="text-sabana">{formatRupiah(totalPrice)}</span>
                  </div>
                  <button onClick={() => { setShowCart(false); setShowCheckout(true); }} className="w-full py-4 bg-sabana text-white rounded-xl font-bold text-lg hover:bg-sabana-dark transition-colors shadow-lg">
                    Checkout →
                  </button>
                </div>
              )}
            </div>
        </ModalShell>
      )}

      {/* Checkout Modal */}
      {showCheckout && (
        <ModalShell open={showCheckout} onClose={() => setShowCheckout(false)} className="max-w-lg">
          <div className="p-5">
            <h2 className="font-heading font-bold text-xl mb-4 dark:text-gray-100">📦 Checkout</h2>

            {/* Order Summary */}
            <div className="bg-gray-50 dark:bg-[#222] rounded-xl p-4 mb-4">
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600 dark:text-gray-400">{item.qty}x {item.name}</span>
                  <span className="font-medium text-gray-800 dark:text-gray-200">{formatRupiah(item.price * item.qty)}</span>
                </div>
              ))}
              <div className="border-t dark:border-[#444] mt-2 pt-2 flex justify-between font-bold">
                <span className="text-gray-800 dark:text-gray-200">Total</span>
                <span className="text-sabana">{formatRupiah(totalPrice)}</span>
              </div>
            </div>

            {/* Delivery Form */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Nama *</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nama lengkap" className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">No. WhatsApp *</label>
                <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="08xxx" className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Alamat Delivery</label>
                <textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} rows={3} placeholder="Alamat lengkap..." className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Catatan</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pedas, level 3, dll..." className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Metode Bayar</label>
                <div className="flex gap-3">
                  <button onClick={() => setPaymentMethod("cash")} className={`flex-1 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${paymentMethod === "cash" ? "border-sabana bg-sabana-50 dark:bg-sabana/10 text-sabana" : "border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400"}`}>
                    💵 Tunai
                  </button>
                  <button onClick={() => setPaymentMethod("qris")} className={`flex-1 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${paymentMethod === "qris" ? "border-sabana bg-sabana-50 dark:bg-sabana/10 text-sabana" : "border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400"}`}>
                    📱 QRIS
                  </button>
                </div>
              </div>
            </div>

            <button onClick={handleOrder} disabled={submitting || !customerName || !customerPhone} className="w-full py-4 bg-sabana text-white rounded-xl font-bold text-lg hover:bg-sabana-dark transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? "Mengirim..." : "✅ Pesan Sekarang"}
            </button>
            <button onClick={() => setShowCheckout(false)} className="w-full py-3 mt-2 text-gray-500 dark:text-gray-400 font-medium hover:text-gray-700 dark:hover:text-gray-200">
              Kembali ke Menu
            </button>
          </div>
        </ModalShell>
      )}

      {/* Floating Cart Button */}
      {totalItems > 0 && !showCart && (
        <div className="fixed bottom-4 left-4 right-4 z-20 max-w-2xl mx-auto">
          <button onClick={() => setShowCart(true)} className="w-full py-4 bg-sabana text-white rounded-2xl font-bold text-lg flex items-center justify-between px-6 shadow-xl shadow-sabana/30 hover:bg-sabana-dark transition-all active:scale-[0.98]">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">{totalItems}</span>
              <span>Lihat Keranjang</span>
            </div>
            <span>{formatRupiah(totalPrice)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
