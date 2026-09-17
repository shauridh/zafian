"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import CategoryBar from "@/components/kasir/CategoryBar";
import ProductGrid from "@/components/kasir/ProductGrid";
import Cart from "@/components/kasir/Cart";
import ServiceModeSelector from "@/components/kasir/ServiceModeSelector";
import PaymentReceiptModal from "@/components/kasir/PaymentReceiptModal";
import RecentOrders from "@/components/kasir/RecentOrders";
import TableSelector from "@/components/kasir/TableSelector";
import OrderNotification from "@/components/kasir/OrderNotification";
import { useCartStore } from "@/stores/cartStore";
import { useShiftStore } from "@/stores/shiftStore";
import { useFeatureToggles } from "@/hooks/useFeatureToggles";
import { useOfflineCategories, useOfflineProducts, useOnlineStatus, saveOrderOfflineFirst } from "@/hooks/useOfflineData";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import type { Product } from "@/types";

const ONLINE_FOOD_MODES = ["gofood", "grabfood", "shopeefood"];

type CashInOut = {
  id: string;
  type: "in" | "out";
  amount: number;
  note: string;
  created_at: string;
};

interface PreOrderData {
  isPreOrder: boolean;
  eventName: string;
  eventDate: string;
  dpAmount: number;
  dpPaid: boolean;
  remainingPayment: string;
}

export default function KasirPage() {
  const router = useRouter();
  const features = useFeatureToggles();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [orderNumber, setOrderNumber] = useState(1);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [paymentResult, setPaymentResult] = useState({ method: "cash", amountPaid: 0, change: 0 });
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [showRecentOrders, setShowRecentOrders] = useState(false);
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [showCashInOut, setShowCashInOut] = useState(false);
  const [cashInOutType, setCashInOutType] = useState<"in" | "out">("in");
  const [cashInOutAmount, setCashInOutAmount] = useState("");
  const [cashInOutNote, setCashInOutNote] = useState("");
  const [cashInOutList, setCashInOutList] = useState<CashInOut[]>([]);
  const [showPreOrder, setShowPreOrder] = useState(false);
  const [preOrder, setPreOrder] = useState<PreOrderData>({ isPreOrder: false, eventName: "", eventDate: "", dpAmount: 0, dpPaid: false, remainingPayment: "cash" });

  const isOnline = useOnlineStatus();
  const { categories: dbCategories, loading: catLoading } = useOfflineCategories();
  const { products: dbProducts, loading: prodLoading } = useOfflineProducts();

  const categories = dbCategories.length > 0 ? dbCategories : [];
  const allProducts = dbProducts.length > 0 ? dbProducts : [];

  const { addItem, serviceMode, setServiceMode, getTotal, clearCart, items } = useCartStore();
  const { isShiftOpen, cashierName, shiftId } = useShiftStore();

  React.useEffect(() => {
    if (!isShiftOpen) {
      router.push("/kasir/shift/open");
    }
  }, [isShiftOpen, router]);

  const stockMap = useMemo(() => {
    const map: Record<string, number> = {};
    dbProducts.forEach((p, i) => {
      if (p.name.includes("Reguler") || p.name.includes("SBP")) map[p.id] = 45 - i * 5;
      else if (p.name.includes("Nasi")) map[p.id] = 100;
      else if (p.name.includes("RB") || p.name.includes("Rice")) map[p.id] = 20;
      else if (p.name.includes("Sambal") || p.name.includes("Saos")) map[p.id] = 25;
      else if (p.name.includes("Paket")) map[p.id] = 0;
      else map[p.id] = 10;
    });
    return Object.keys(map).length > 0 ? map : stock;
  }, [dbProducts, stock]);

  const filteredProducts = useMemo(() => {
    const list = allProducts.filter((p) => p.is_active);
    if (searchQuery) {
      return list.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku?.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (selectedCategory) {
      return list.filter((p) => p.category_id === selectedCategory);
    }
    return list;
  }, [allProducts, selectedCategory, searchQuery]);

  const handleProductSelect = (product: Product) => {
    if ((stockMap[product.id] ?? 0) <= 0) return;
    addItem({ id: product.id, product_id: product.id, name: product.name, price: product.price, image_url: product.image_url });
  };

  const handlePaymentComplete = async (method: string, amountPaid: number, loyaltyCustomer?: any) => {
    const total = getTotal();
    const isOnlineFood = ONLINE_FOOD_MODES.includes(serviceMode);
    const finalMethod = isOnlineFood ? "estimate" : method;
    const finalAmountPaid = isOnlineFood ? 0 : amountPaid;
    const finalChange = isOnlineFood ? 0 : (method === "cash" ? amountPaid - total : 0);

    setSaving(true);
    try {
      const orderItems = items.map((item) => ({
        product_id: item.product_id, quantity: item.quantity, unit_price: item.price, discount: 0, subtotal: item.price * item.quantity,
      }));

      const { orderId, synced } = await saveOrderOfflineFirst(
        {
          outlet_id: "00000000-0000-0000-0000-000000000001",
          cashier_id: useShiftStore.getState().cashierId || "30000000-0000-0000-0000-000000000001",
          shift_id: useShiftStore.getState().shiftId,
          service_mode: serviceMode,
          total, final_total: total, payment_method: finalMethod, amount_paid: finalAmountPaid, change_amount: finalChange, status: "completed",
        }, orderItems
      );

      setSavedOrderId(orderId);

      if (loyaltyCustomer?.id && orderId) {
        try {
          const { earnPoints } = await import("@/lib/loyalty");
          const result = await earnPoints(loyaltyCustomer.id, orderId, total);
          if (result.points_earned > 0) console.log(`[POS] Loyalty: +${result.points_earned} poin`);
        } catch (err) { console.error("[POS] Loyalty error:", err); }
      }

      const newStock = { ...stockMap };
      items.forEach((item) => { if (newStock[item.product_id] !== undefined) newStock[item.product_id] = Math.max(0, newStock[item.product_id] - item.quantity); });
      setStock(newStock);
      setPaymentResult({ method: finalMethod, amountPaid: finalAmountPaid, change: finalChange });
      setShowPayment(false);
      setShowReceipt(true);
      setOrderNumber((n) => n + 1);
    } catch (err: any) {
      const newStock = { ...stockMap };
      items.forEach((item) => { if (newStock[item.product_id] !== undefined) newStock[item.product_id] = Math.max(0, newStock[item.product_id] - item.quantity); });
      setStock(newStock);
      setPaymentResult({ method: finalMethod, amountPaid: finalAmountPaid, change: finalChange });
      setShowPayment(false);
      setShowReceipt(true);
      setOrderNumber((n) => n + 1);
    } finally { setSaving(false); }
  };

  const handleReceiptClose = () => { setShowReceipt(false); clearCart(); };

  const handleCashInOut = () => {
    const amount = parseInt(cashInOutAmount) || 0;
    if (amount <= 0) return alert("Jumlah harus lebih dari 0!");
    setCashInOutList((prev) => [...prev, { id: Date.now().toString(), type: cashInOutType, amount, note: cashInOutNote || (cashInOutType === "in" ? "Cash In" : "Cash Out"), created_at: new Date().toISOString() }]);
    setCashInOutAmount(""); setCashInOutNote(""); setShowCashInOut(false);
  };

  const handleSaveOrder = async () => {
    if (items.length === 0) return alert("Keranjang kosong!");
    setSaving(true);
    try {
      const orderItems = items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_price: item.price, discount: 0, subtotal: item.price * item.quantity }));
      const { orderId } = await saveOrderOfflineFirst(
        {
          outlet_id: "00000000-0000-0000-0000-000000000001",
          cashier_id: useShiftStore.getState().cashierId || "",
          shift_id: useShiftStore.getState().shiftId,
          service_mode: serviceMode, total: getTotal(), final_total: getTotal(), payment_method: "pending", amount_paid: 0, change_amount: 0, status: "saved",
          customer_name: preOrder.isPreOrder ? preOrder.eventName : undefined,
          notes: preOrder.isPreOrder ? `Pre-Order: ${preOrder.eventName} | DP: ${preOrder.dpAmount}` : undefined,
        }, orderItems
      );
      alert(`Pesanan tersimpan! ID: ${orderId.slice(0, 8)}...`);
      clearCart();
      setPreOrder({ isPreOrder: false, eventName: "", eventDate: "", dpAmount: 0, dpPaid: false, remainingPayment: "cash" });
    } catch (err: any) { alert("Gagal menyimpan: " + err.message); } finally { setSaving(false); }
  };

  const dataReady = !catLoading && !prodLoading;
  if (!isShiftOpen) return null;

  // Online food modes to exclude when toggle is off
  const onlineFoodExclude = features.onlineFood ? [] : ONLINE_FOOD_MODES;

  return (
    <div className="h-screen flex flex-col bg-cream dark:bg-[#0f0f0f] overflow-hidden tablet-safe">
      {/* Header — compact */}
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
          {features.cashInOut && (
            <button onClick={() => setShowCashInOut(true)} className="p-1.5 sm:p-2 rounded-lg bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-700 dark:text-green-400 transition-colors" title="Cash In/Out">💰</button>
          )}
          <button onClick={() => setShowRecentOrders(true)} className="p-1.5 sm:p-2 rounded-lg bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#444] text-gray-600 dark:text-gray-400 transition-colors" title="Order Hari Ini">📋</button>
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

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Product area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Service mode + Search + Categories — compact */}
          <div className="px-2 sm:px-3 py-1.5 bg-white dark:bg-[#1a1a1a] border-b border-gray-100 dark:border-[#333] space-y-1 sm:space-y-1.5 shrink-0">
            <ServiceModeSelector selected={serviceMode} onSelect={setServiceMode} excludeModes={onlineFoodExclude} />
            {features.tableSelector && serviceMode === "dine_in" && (
              <TableSelector selectedTable={selectedTable} onSelect={setSelectedTable} visible={true} />
            )}
            <div className="relative">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input type="text" placeholder="Cari produk..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-1.5 sm:py-2 rounded-lg border border-gray-200 dark:border-[#444] bg-white dark:bg-[#262626] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sabana text-xs sm:text-sm" />
            </div>
            <CategoryBar categories={categories} selectedId={selectedCategory} onSelect={(id) => { setSelectedCategory(id); setSearchQuery(""); }} />
          </div>

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto p-2 sm:p-3 min-h-0">
            {prodLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <div className="text-center">
                  <div className="w-7 h-7 border-2 border-sabana border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-[10px]">Memuat produk...</p>
                </div>
              </div>
            ) : (
              <div className="product-grid-tablet">
                <ProductGrid products={filteredProducts} stock={stockMap} onSelect={handleProductSelect} searchQuery={searchQuery} />
              </div>
            )}
          </div>
        </div>

        {/* Desktop sidebar cart — tablet landscape and up */}
        <div className="w-[300px] lg:w-[320px] border-l border-gray-200 dark:border-[#333] p-1.5 hidden lg:flex flex-col shrink-0">
          <Cart onCheckout={() => setShowPayment(true)} />
          {items.length > 0 && (
            <div className="flex gap-1.5 mt-1.5 px-0.5">
              <button onClick={handleSaveOrder} disabled={saving} className="flex-1 py-2 bg-blue-500 text-white rounded-lg text-[10px] sm:text-xs font-bold hover:bg-blue-600 transition-colors disabled:opacity-50">💾 Simpan</button>
              {features.preOrder && (
                <button onClick={() => setShowPreOrder(true)} className="flex-1 py-2 bg-purple-500 text-white rounded-lg text-[10px] sm:text-xs font-bold hover:bg-purple-600 transition-colors">📅 Pre-Order</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Cart FAB */}
      <div className="lg:hidden fixed bottom-3 right-3 z-20 flex flex-col gap-1.5 items-end">
        {items.length > 0 && features.preOrder && (
          <button onClick={() => setShowPreOrder(true)} className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-purple-500 text-white shadow-lg flex items-center justify-center text-xs sm:text-sm active:scale-95 transition-all" title="Pre-Order">📅</button>
        )}
        {items.length > 0 && (
          <button onClick={handleSaveOrder} disabled={saving} className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-blue-500 text-white shadow-lg flex items-center justify-center text-xs sm:text-sm active:scale-95 transition-all disabled:opacity-50" title="Simpan">💾</button>
        )}
        <button onClick={() => setShowMobileCart(true)} className="relative w-12 h-12 sm:w-13 sm:h-13 rounded-full bg-sabana text-white shadow-xl shadow-sabana/30 flex items-center justify-center text-lg sm:text-xl active:scale-95 transition-all">
          🛒
          {items.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 sm:w-5 sm:h-5 bg-danger text-white text-[9px] sm:text-[10px] font-bold rounded-full flex items-center justify-center">{items.reduce((s, i) => s + i.quantity, 0)}</span>
          )}
        </button>
      </div>

      {/* Mobile Cart Drawer */}
      {showMobileCart && (
        <div className="lg:hidden fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileCart(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[320px] sm:w-[340px] max-w-[85vw]">
            <Cart onCheckout={() => { setShowMobileCart(false); setShowPayment(true); }} />
          </div>
        </div>
      )}

      {/* Modals */}
      <PaymentReceiptModal
        isOpen={showPayment || showReceipt}
        onClose={() => { setShowPayment(false); setShowReceipt(false); }}
        onComplete={handlePaymentComplete}
        saving={saving}
        orderNumber={orderNumber}
        paymentResult={showReceipt ? paymentResult : undefined}
        savedOrderId={savedOrderId}
      />
      <RecentOrders isOpen={showRecentOrders} onClose={() => setShowRecentOrders(false)} />
      <OrderNotification />

      {/* Cash In/Out Modal — compact */}
      {showCashInOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCashInOut(false)} />
          <div className="relative bg-white dark:bg-[#1a1a1a] rounded-2xl w-full max-w-xs p-4 shadow-2xl">
            <h3 className="font-heading font-bold text-base mb-3 dark:text-gray-100">💰 Cash In / Cash Out</h3>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setCashInOutType("in")} className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${cashInOutType === "in" ? "bg-green-500 text-white shadow-lg" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>💵 Cash In</button>
              <button onClick={() => setCashInOutType("out")} className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${cashInOutType === "out" ? "bg-red-500 text-white shadow-lg" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>💸 Cash Out</button>
            </div>
            <div className="space-y-2 mb-3">
              <input type="number" value={cashInOutAmount} onChange={(e) => setCashInOutAmount(e.target.value)} placeholder="Jumlah (Rp)" className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-base font-bold font-mono" />
              <div className="flex gap-1.5">
                {[10000, 20000, 50000, 100000].map((v) => (
                  <button key={v} onClick={() => setCashInOutAmount((parseInt(cashInOutAmount || "0") + v).toString())} className="flex-1 py-1.5 rounded-lg bg-gray-100 dark:bg-[#222] text-[10px] font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#333]">{formatRupiah(v)}</button>
                ))}
              </div>
              <input type="text" value={cashInOutNote} onChange={(e) => setCashInOutNote(e.target.value)} placeholder="Catatan..." className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-xs" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowCashInOut(false)} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 font-semibold text-xs">Batal</button>
              <button onClick={handleCashInOut} className={`flex-1 py-2 rounded-xl font-bold text-white text-xs ${cashInOutType === "in" ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"}`}>Simpan</button>
            </div>
            {cashInOutList.length > 0 && (
              <div className="mt-3 border-t dark:border-[#333] pt-2 max-h-28 overflow-y-auto">
                <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Riwayat Hari Ini</p>
                {cashInOutList.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${entry.type === "in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{entry.type === "in" ? "IN" : "OUT"}</span>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[100px]">{entry.note}</span>
                    </div>
                    <span className={`text-[10px] font-bold ${entry.type === "in" ? "text-green-600" : "text-red-600"}`}>{entry.type === "in" ? "+" : "-"}{formatRupiah(entry.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pre-Order Modal — compact */}
      {showPreOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPreOrder(false)} />
          <div className="relative bg-white dark:bg-[#1a1a1a] rounded-2xl w-full max-w-xs p-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <h3 className="font-heading font-bold text-base mb-0.5 dark:text-gray-100">📅 Pre-Order Event</h3>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-3">Pesan untuk acara dengan DP</p>
            <div className="space-y-2 mb-3">
              <div>
                <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">Nama Acara *</label>
                <input type="text" value={preOrder.eventName} onChange={(e) => setPreOrder({ ...preOrder, eventName: e.target.value })} placeholder="Ulang Tahun, Resepsi..." className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">Tanggal Acara</label>
                <input type="date" value={preOrder.eventDate} onChange={(e) => setPreOrder({ ...preOrder, eventDate: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">DP *</label>
                <input type="number" value={preOrder.dpAmount || ""} onChange={(e) => setPreOrder({ ...preOrder, dpAmount: parseInt(e.target.value) || 0 })} placeholder="0" className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-base font-bold font-mono" />
                <div className="flex gap-1.5 mt-1.5">
                  {[100000, 200000, 500000].map((v) => (
                    <button key={v} onClick={() => setPreOrder({ ...preOrder, dpAmount: v })} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${preOrder.dpAmount === v ? "bg-sabana text-white" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>{formatRupiah(v)}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">Pelunasan</label>
                <div className="flex gap-1.5">
                  {["cash", "qris", "transfer"].map((m) => (
                    <button key={m} onClick={() => setPreOrder({ ...preOrder, remainingPayment: m })} className={`flex-1 py-2 rounded-xl text-[10px] font-bold transition-all ${preOrder.remainingPayment === m ? "bg-sabana text-white" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>{m === "cash" ? "💵 Tunai" : m === "qris" ? "📱 QRIS" : "🏦 Transfer"}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="bg-sabana-50 dark:bg-sabana/10 rounded-xl p-2 mb-3">
              <div className="flex justify-between text-xs"><span className="text-gray-600 dark:text-gray-400">Total</span><span className="font-bold text-gray-800 dark:text-gray-200">{formatRupiah(getTotal())}</span></div>
              <div className="flex justify-between text-xs"><span className="text-gray-600 dark:text-gray-400">DP</span><span className="font-bold text-sabana">-{formatRupiah(preOrder.dpAmount)}</span></div>
              <div className="flex justify-between text-xs font-bold border-t dark:border-[#444] mt-1 pt-1"><span className="text-gray-800 dark:text-gray-200">Sisa</span><span className="text-sabana">{formatRupiah(Math.max(0, getTotal() - preOrder.dpAmount))}</span></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowPreOrder(false)} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 font-semibold text-xs">Batal</button>
              <button onClick={() => { setShowPreOrder(false); setPreOrder({ ...preOrder, isPreOrder: true }); }} disabled={!preOrder.eventName} className="flex-1 py-2 rounded-xl bg-sabana text-white font-bold text-xs disabled:opacity-50">Simpan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
