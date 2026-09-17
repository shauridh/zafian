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
import CashInOutModal from "@/components/kasir/CashInOutModal";
import PreOrderModal, { EMPTY_PREORDER, type PreOrderData } from "@/components/kasir/PreOrderModal";
import MobileCartDrawer from "@/components/kasir/MobileCartDrawer";
import POSHeader from "@/components/kasir/POSHeader";
import { useCartStore } from "@/stores/cartStore";
import { useShiftStore } from "@/stores/shiftStore";
import { useFeatureToggles } from "@/hooks/useFeatureToggles";
import { useOfflineCategories, useOfflineProducts, useOnlineStatus, saveOrderOfflineFirst } from "@/hooks/useOfflineData";
import type { Product } from "@/types";

const ONLINE_FOOD_MODES = ["gofood", "grabfood", "shopeefood"];

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
  const [paymentResult, setPaymentResult] = useState<{ method: string; amountPaid: number; change: number } | undefined>(undefined);
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [showRecentOrders, setShowRecentOrders] = useState(false);
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [showCashInOut, setShowCashInOut] = useState(false);
  const [showPreOrder, setShowPreOrder] = useState(false);
  const [preOrder, setPreOrder] = useState<PreOrderData>(EMPTY_PREORDER);

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

  const handlePaymentComplete = async (method: string, amountPaid: number) => {
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
      setPreOrder(EMPTY_PREORDER);
    } catch (err: any) { alert("Gagal menyimpan: " + err.message); } finally { setSaving(false); }
  };

  const dataReady = !catLoading && !prodLoading;
  if (!isShiftOpen) return null;

  // Online food modes to exclude when toggle is off
  const onlineFoodExclude = features.onlineFood ? [] : ONLINE_FOOD_MODES;

  return (
    <div className="h-screen flex flex-col bg-cream dark:bg-[#0f0f0f] overflow-hidden tablet-safe">
      {/* Header — compact */}
      <POSHeader isOnline={isOnline} dataReady={dataReady} showCashInOut={features.cashInOut} onOpenCashInOut={() => setShowCashInOut(true)} onOpenRecentOrders={() => setShowRecentOrders(true)} />

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
      <MobileCartDrawer isOpen={showMobileCart} onClose={() => setShowMobileCart(false)} onCheckout={() => setShowPayment(true)} />

      {/* Modals */}
      <PaymentReceiptModal
        isOpen={showPayment || showReceipt}
        onClose={() => {
          // Tutup modal — jika sudah bayar, keranjang dikosongkan (Transaksi Baru)
          if (showReceipt || paymentResult) { setShowReceipt(false); clearCart(); setPaymentResult(undefined); setSavedOrderId(null); }
          setShowPayment(false);
        }}
        onComplete={handlePaymentComplete}
        saving={saving}
        orderNumber={orderNumber}
        paymentResult={showReceipt ? paymentResult : undefined}
        savedOrderId={savedOrderId}
      />
      <RecentOrders isOpen={showRecentOrders} onClose={() => setShowRecentOrders(false)} />
      <OrderNotification />

      {/* Cash In/Out */}
      <CashInOutModal isOpen={showCashInOut} onClose={() => setShowCashInOut(false)} />

      {/* Pre-Order */}
      <PreOrderModal isOpen={showPreOrder} onClose={() => setShowPreOrder(false)} preOrder={preOrder} onChange={setPreOrder} />
    </div>
  );
}
