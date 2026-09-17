"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import CategoryBar from "@/components/kasir/CategoryBar";
import ProductGrid from "@/components/kasir/ProductGrid";
import Cart from "@/components/kasir/Cart";
import ServiceModeSelector from "@/components/kasir/ServiceModeSelector";
import PaymentModal from "@/components/kasir/PaymentModal";
import ReceiptPreview from "@/components/kasir/ReceiptPreview";
import RecentOrders from "@/components/kasir/RecentOrders";
import TableSelector from "@/components/kasir/TableSelector";
import OrderNotification from "@/components/kasir/OrderNotification";
import { useCartStore } from "@/stores/cartStore";
import { useShiftStore } from "@/stores/shiftStore";
import { useOfflineCategories, useOfflineProducts, useOnlineStatus, saveOrderOfflineFirst } from "@/hooks/useOfflineData";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import type { Product } from "@/types";

// Fallback mock data if Supabase is not connected
const FALLBACK_CATEGORIES = [
  { id: "cat-1", name: "Ayam Goreng", icon: "🍗", color: "#EA580C", sort_order: 1, is_active: true, created_at: "" },
  { id: "cat-2", name: "Nasi", icon: "🍚", color: "#16A34A", sort_order: 2, is_active: true, created_at: "" },
  { id: "cat-3", name: "Rice Bowl", icon: "🍱", color: "#7C3AED", sort_order: 3, is_active: true, created_at: "" },
  { id: "cat-4", name: "Sambal & Saus", icon: "🥘", color: "#DC2626", sort_order: 4, is_active: true, created_at: "" },
  { id: "cat-5", name: "Side Menu", icon: "🍢", color: "#2563EB", sort_order: 5, is_active: true, created_at: "" },
  { id: "cat-6", name: "Burger & Bun", icon: "🍔", color: "#D97706", sort_order: 6, is_active: true, created_at: "" },
  { id: "cat-7", name: "Minuman", icon: "🥤", color: "#0891B2", sort_order: 7, is_active: true, created_at: "" },
  { id: "cat-8", name: "Paket", icon: "📦", color: "#BE185D", sort_order: 8, is_active: true, created_at: "" },
];

const FALLBACK_PRODUCTS: Product[] = [
  { id: "p-1", category_id: "cat-1", name: "Ayam Reguler (9 potong)", price: 89000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-2", category_id: "cat-1", name: "Ayam SBP (9 potong)", price: 89000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-3", category_id: "cat-1", name: "Dada", price: 11000, unit: "pcs", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-4", category_id: "cat-1", name: "Paha Atas", price: 11000, unit: "pcs", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-5", category_id: "cat-1", name: "Paha Bawah", price: 9000, unit: "pcs", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-6", category_id: "cat-1", name: "Sayap", price: 8000, unit: "pcs", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-7", category_id: "cat-2", name: "Nasi Putih", price: 5000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-8", category_id: "cat-3", name: "RB Sambal Geprek 650ml", price: 15000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-9", category_id: "cat-3", name: "RB BBQ Sauce 650ml", price: 15000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-10", category_id: "cat-3", name: "RB Katsu 650ml", price: 15000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-11", category_id: "cat-3", name: "RB Geprek 500ml", price: 12000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-12", category_id: "cat-3", name: "RB BBQ 500ml", price: 12000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-13", category_id: "cat-4", name: "Sambal Geprek", price: 4000, unit: "cup", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-14", category_id: "cat-4", name: "Sambal Hitam", price: 4000, unit: "cup", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-15", category_id: "cat-4", name: "Sambal Ijo", price: 4000, unit: "cup", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-16", category_id: "cat-4", name: "Saos Buldak", price: 3000, unit: "cup", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-17", category_id: "cat-4", name: "Saos Mentai", price: 2000, unit: "cup", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-18", category_id: "cat-4", name: "Saos Sadas", price: 3000, unit: "cup", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-19", category_id: "cat-5", name: "Chicken Roll", price: 4000, unit: "tusuk", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-20", category_id: "cat-5", name: "Bakso", price: 4000, unit: "tusuk", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-21", category_id: "cat-5", name: "Chicken Strip", price: 4000, unit: "tusuk", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-22", category_id: "cat-5", name: "Kulit Crispy", price: 5000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-23", category_id: "cat-5", name: "Chicken Katsu", price: 8000, unit: "pcs", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-24", category_id: "cat-5", name: "Kentang Goreng", price: 8000, unit: "porsi", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-25", category_id: "cat-6", name: "Burger", price: 12000, unit: "pcs", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-26", category_id: "cat-6", name: "Chicken Bun", price: 10000, unit: "pcs", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-27", category_id: "cat-7", name: "Fruit Tea Apple", price: 3000, unit: "botol", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-28", category_id: "cat-7", name: "Fruit Tea Blackcurrant", price: 3000, unit: "botol", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-29", category_id: "cat-7", name: "Fruit Tea Lemon", price: 3000, unit: "botol", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-30", category_id: "cat-7", name: "Teh Sosro", price: 3000, unit: "botol", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-31", category_id: "cat-7", name: "Air Mineral", price: 3000, unit: "botol", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-32", category_id: "cat-8", name: "Paket Nasi Ayam", price: 95000, unit: "paket", is_active: true, is_available: true, created_at: "", updated_at: "" },
  { id: "p-33", category_id: "cat-8", name: "Paket Komplit", price: 115000, unit: "paket", is_active: true, is_available: true, created_at: "", updated_at: "" },
];

const MOCK_STOCK: Record<string, number> = {
  "p-1": 45, "p-2": 30, "p-3": 15, "p-4": 10, "p-5": 10, "p-6": 10,
  "p-7": 100, "p-8": 20, "p-9": 20, "p-10": 20, "p-11": 20, "p-12": 20,
  "p-13": 25, "p-14": 25, "p-15": 25, "p-16": 25, "p-17": 25, "p-18": 25,
  "p-19": 10, "p-20": 10, "p-21": 3, "p-22": 10, "p-23": 10, "p-24": 15,
  "p-25": 10, "p-26": 10, "p-27": 24, "p-28": 24, "p-29": 24, "p-30": 24, "p-31": 24,
  "p-32": 0, "p-33": 0,
};

const ONLINE_FOOD_MODES = ["gofood", "grabfood", "shopeefood"];

// Cash In/Out types
type CashInOut = {
  id: string;
  type: "in" | "out";
  amount: number;
  note: string;
  created_at: string;
};

// Pre-order types
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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null); // null = show all
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
  const [stock, setStock] = useState(MOCK_STOCK);
  const [showCashInOut, setShowCashInOut] = useState(false);
  const [cashInOutType, setCashInOutType] = useState<"in" | "out">("in");
  const [cashInOutAmount, setCashInOutAmount] = useState("");
  const [cashInOutNote, setCashInOutNote] = useState("");
  const [cashInOutList, setCashInOutList] = useState<CashInOut[]>([]);
  const [showPreOrder, setShowPreOrder] = useState(false);
  const [preOrder, setPreOrder] = useState<PreOrderData>({ isPreOrder: false, eventName: "", eventDate: "", dpAmount: 0, dpPaid: false, remainingPayment: "cash" });

  // Offline-first data (Dexie → Supabase fallback)
  const isOnline = useOnlineStatus();
  const { categories: dbCategories, loading: catLoading } = useOfflineCategories();
  const { products: dbProducts, loading: prodLoading } = useOfflineProducts();

  // Use DB data if available, fallback to mock
  const categories = dbCategories.length > 0 ? dbCategories : FALLBACK_CATEGORIES;
  const allProducts = dbProducts.length > 0 ? dbProducts : FALLBACK_PRODUCTS;

  // Don't auto-select category — show all products by default
  // User can tap a category to filter

  const { addItem, serviceMode, setServiceMode, getTotal, clearCart, items } = useCartStore();
  const { isShiftOpen, cashierName, openShift, shiftId } = useShiftStore();

  // Redirect to login if no shift is open
  React.useEffect(() => {
    if (!isShiftOpen) {
      router.push("/login");
    }
  }, [isShiftOpen, router]);

  // Map Supabase product IDs (UUIDs) to stock keys
  const stockMap = useMemo(() => {
    const map: Record<string, number> = {};
    dbProducts.forEach((p, i) => {
      // Generate stock based on product type
      if (p.name.includes("Reguler") || p.name.includes("SBP")) map[p.id] = 45 - i * 5;
      else if (p.name.includes("Nasi")) map[p.id] = 100;
      else if (p.name.includes("RB") || p.name.includes("Rice")) map[p.id] = 20;
      else if (p.name.includes("Sambal") || p.name.includes("Saos")) map[p.id] = 25;
      else if (p.name.includes("Paket")) map[p.id] = 0;
      else map[p.id] = 10;
    });
    return Object.keys(map).length > 0 ? map : MOCK_STOCK;
  }, [dbProducts]);

  const filteredProducts = useMemo(() => {
    const list = allProducts.filter((p) => p.is_active);
    if (searchQuery) {
      return list.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.sku?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (selectedCategory) {
      return list.filter((p) => p.category_id === selectedCategory);
    }
    return list;
  }, [allProducts, selectedCategory, searchQuery]);

  const handleProductSelect = (product: Product) => {
    if ((stockMap[product.id] ?? 0) <= 0) return;
    addItem({
      id: product.id,
      product_id: product.id,
      name: product.name,
      price: product.price,
      image_url: product.image_url,
    });
  };

  const handlePaymentComplete = async (method: string, amountPaid: number, loyaltyCustomer?: any) => {
    const total = getTotal();
    const isOnlineFood = ONLINE_FOOD_MODES.includes(serviceMode);
    const finalMethod = isOnlineFood ? "estimate" : method;
    const finalAmountPaid = isOnlineFood ? 0 : amountPaid;
    const finalChange = isOnlineFood ? 0 : (method === "cash" ? amountPaid - total : 0);

    setSaving(true);
    try {
      // Save order offline-first (Dexie always, Supabase if online)
      const orderItems = items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.price,
        discount: 0,
        subtotal: item.price * item.quantity,
      }));

      const { orderId, synced } = await saveOrderOfflineFirst(
        {
          outlet_id: "00000000-0000-0000-0000-000000000001",
          cashier_id: useShiftStore.getState().cashierId || "30000000-0000-0000-0000-000000000001",
          shift_id: useShiftStore.getState().shiftId,
          service_mode: serviceMode,
          total: total,
          final_total: total,
          payment_method: finalMethod,
          amount_paid: finalAmountPaid,
          change_amount: finalChange,
          status: "completed",
        },
        orderItems
      );

      setSavedOrderId(orderId);
      console.log(`[POS] Order saved: ${orderId} (synced: ${synced})`);

      // Earn loyalty points if customer found
      if (loyaltyCustomer?.id && orderId) {
        try {
          const { earnPoints } = await import("@/lib/loyalty");
          const result = await earnPoints(loyaltyCustomer.id, orderId, total);
          if (result.points_earned > 0) {
            console.log(`[POS] Loyalty: +${result.points_earned} poin, +${result.stamps_earned} stamp`);
          }
        } catch (err) {
          console.error("[POS] Loyalty points error:", err);
        }
      }

      // Update local stock
      const newStock = { ...stockMap };
      items.forEach((item) => {
        if (newStock[item.product_id] !== undefined) {
          newStock[item.product_id] = Math.max(0, newStock[item.product_id] - item.quantity);
        }
      });
      setStock(newStock);

      setPaymentResult({
        method: finalMethod,
        amountPaid: finalAmountPaid,
        change: finalChange,
      });
      setShowPayment(false);
      setShowReceipt(true);
      setOrderNumber((n) => n + 1);
    } catch (err: any) {
      console.error("Error saving order:", err);
      // Still show receipt even if save fails
      const newStock = { ...stockMap };
      items.forEach((item) => {
        if (newStock[item.product_id] !== undefined) {
          newStock[item.product_id] = Math.max(0, newStock[item.product_id] - item.quantity);
        }
      });
      setStock(newStock);
      setPaymentResult({ method: finalMethod, amountPaid: finalAmountPaid, change: finalChange });
      setShowPayment(false);
      setShowReceipt(true);
      setOrderNumber((n) => n + 1);
    } finally {
      setSaving(false);
    }
  };

  const handleReceiptClose = () => {
    setShowReceipt(false);
    clearCart();
  };

  // Cash In/Out handler
  const handleCashInOut = () => {
    const amount = parseInt(cashInOutAmount) || 0;
    if (amount <= 0) return alert("Jumlah harus lebih dari 0!");
    const newEntry: CashInOut = {
      id: Date.now().toString(),
      type: cashInOutType,
      amount,
      note: cashInOutNote || (cashInOutType === "in" ? "Cash In" : "Cash Out"),
      created_at: new Date().toISOString(),
    };
    setCashInOutList((prev) => [...prev, newEntry]);
    setCashInOutAmount("");
    setCashInOutNote("");
    setShowCashInOut(false);
  };

  // Save order without payment (bill in / temporary save)
  const handleSaveOrder = async () => {
    if (items.length === 0) return alert("Keranjang kosong!");
    setSaving(true);
    try {
      const orderItems = items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.price,
        discount: 0,
        subtotal: item.price * item.quantity,
      }));
      const { orderId } = await saveOrderOfflineFirst(
        {
          outlet_id: "00000000-0000-0000-0000-000000000001",
          cashier_id: useShiftStore.getState().cashierId || "",
          shift_id: useShiftStore.getState().shiftId,
          service_mode: serviceMode,
          total: getTotal(),
          final_total: getTotal(),
          payment_method: "pending",
          amount_paid: 0,
          change_amount: 0,
          status: "saved",
          customer_name: preOrder.isPreOrder ? preOrder.eventName : undefined,
          notes: preOrder.isPreOrder ? `Pre-Order: ${preOrder.eventName} | DP: ${preOrder.dpAmount}` : undefined,
        },
        orderItems
      );
      alert(`Pesanan tersimpan! ID: ${orderId.slice(0, 8)}...`);
      clearCart();
      setPreOrder({ isPreOrder: false, eventName: "", eventDate: "", dpAmount: 0, dpPaid: false, remainingPayment: "cash" });
    } catch (err: any) {
      alert("Gagal menyimpan: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const dataReady = !catLoading && !prodLoading;

  // Don't render if no shift is open (will redirect)
  if (!isShiftOpen) return null;

  return (
    <div className="h-screen flex flex-col bg-cream dark:bg-[#0f0f0f] overflow-hidden tablet-safe">
      {/* Header */}
      <header className="bg-white dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-[#333] px-3 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">🍗</span>
          <h1 className="font-heading font-bold text-lg text-sabana hidden sm:block">SABANA POS</h1>
          {!dataReady && (
            <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium animate-pulse">
              Syncing...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-success animate-pulse" : "bg-danger"}`} />
            <span className={`text-xs font-medium hidden sm:block ${isOnline ? "text-gray-600 dark:text-gray-400" : "text-danger"}`}>
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
          <div className="text-xs font-mono text-gray-500 dark:text-gray-400 hidden sm:block">
            {new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </div>
          <button onClick={() => setShowRecentOrders(true)} className="p-2 rounded-lg bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#444] text-gray-600 dark:text-gray-400 transition-colors text-sm" title="Order Hari Ini">
            📋
          </button>
          <button onClick={() => setShowCashInOut(true)} className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-700 dark:text-green-400 transition-colors text-sm" title="Cash In/Out">
            💰
          </button>
          <ThemeToggle />
          <div className="flex items-center gap-1.5 bg-sabana-50 dark:bg-sabana/10 px-2 py-1 rounded-lg">
            <div className="w-6 h-6 rounded-full bg-sabana text-white flex items-center justify-center text-xs font-bold">
              {cashierName?.charAt(0) || "K"}
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 hidden sm:block">{cashierName || "Kasir"}</span>
          </div>
          {/* Shift indicator */}
          {isShiftOpen && (
            <button
              onClick={() => router.push("/kasir/shift/close")}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-green-50 hover:bg-red-50 text-green-700 hover:text-danger transition-colors border border-green-200 hover:border-red-200"
              title="Tutup Shift"
            >
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-xs font-medium hidden sm:block">Shift Aktif</span>
            </button>
          )}
          <button onClick={() => router.push("/admin/dashboard")} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors" title="Admin Panel">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>
          <button onClick={() => router.push("/login")} className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-danger transition-colors" title="Keluar">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="px-3 py-2 bg-white dark:bg-[#1a1a1a] border-b border-gray-100 dark:border-[#333] space-y-2 shrink-0">
            <ServiceModeSelector selected={serviceMode} onSelect={setServiceMode} />
            {serviceMode === 'dine_in' && (
              <TableSelector selectedTable={selectedTable} onSelect={setSelectedTable} visible={true} />
            )}
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input type="text" placeholder="Cari produk..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-[#444] bg-white dark:bg-[#262626] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
            </div>
            <CategoryBar categories={categories} selectedId={selectedCategory} onSelect={(id) => { setSelectedCategory(id); setSearchQuery(""); }} />
          </div>
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {/* Product grid uses CSS grid for tablet */}
            {prodLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs">Memuat produk dari database...</p>
                </div>
              </div>
            ) : (
              <div className="product-grid-tablet">
              <ProductGrid products={filteredProducts} stock={stockMap} onSelect={handleProductSelect} searchQuery={searchQuery} />
            </div>
            )}
          </div>
        </div>
        <div className="w-[340px] border-l border-gray-200 dark:border-[#333] p-2 hidden lg:flex flex-col shrink-0">
          <Cart onCheckout={() => setShowPayment(true)} />
          {items.length > 0 && (
            <div className="flex gap-2 mt-2 px-1">
              <button onClick={handleSaveOrder} disabled={saving} className="flex-1 py-2.5 bg-blue-500 text-white rounded-xl text-xs font-bold hover:bg-blue-600 transition-colors disabled:opacity-50">💾 Simpan</button>
              <button onClick={() => setShowPreOrder(true)} className="flex-1 py-2.5 bg-purple-500 text-white rounded-xl text-xs font-bold hover:bg-purple-600 transition-colors">📅 Pre-Order</button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Cart Toggle */}
      <div className="lg:hidden fixed bottom-4 right-4 z-20 flex flex-col gap-2 items-end">
        {items.length > 0 && (
          <>
            <button onClick={() => setShowPreOrder(true)} className="w-12 h-12 rounded-full bg-purple-500 text-white shadow-lg flex items-center justify-center text-sm active:scale-95 transition-all" title="Pre-Order">
              📅
            </button>
            <button onClick={handleSaveOrder} disabled={saving} className="w-12 h-12 rounded-full bg-blue-500 text-white shadow-lg flex items-center justify-center text-sm active:scale-95 transition-all disabled:opacity-50" title="Simpan Pesanan">
              💾
            </button>
          </>
        )}
        <button onClick={() => setShowMobileCart(true)} className="relative w-14 h-14 rounded-full bg-sabana text-white shadow-xl shadow-sabana/30 flex items-center justify-center text-xl active:scale-95 transition-all">
          🛒
          {items.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-danger text-white text-xs font-bold rounded-full flex items-center justify-center">
              {items.reduce((s, i) => s + i.quantity, 0)}
            </span>
          )}
        </button>
      </div>

      {showMobileCart && (
        <div className="lg:hidden fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileCart(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[360px] max-w-[90vw]">
            <Cart onCheckout={() => { setShowMobileCart(false); setShowPayment(true); }} />
          </div>
        </div>
      )}

      <PaymentModal isOpen={showPayment} onClose={() => setShowPayment(false)} onComplete={handlePaymentComplete} saving={saving} />
      <ReceiptPreview isOpen={showReceipt} onClose={handleReceiptClose} orderNumber={orderNumber} amountPaid={paymentResult.amountPaid} paymentMethod={paymentResult.method} changeAmount={paymentResult.change} savedOrderId={savedOrderId} />
      <RecentOrders isOpen={showRecentOrders} onClose={() => setShowRecentOrders(false)} />
      <OrderNotification />

      {/* Cash In/Out Modal */}
      {showCashInOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCashInOut(false)} />
          <div className="relative bg-white dark:bg-[#1a1a1a] rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="font-heading font-bold text-lg mb-4 dark:text-gray-100">💰 Cash In / Cash Out</h3>
            <div className="flex gap-2 mb-4">
              <button onClick={() => setCashInOutType("in")} className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${cashInOutType === "in" ? "bg-green-500 text-white shadow-lg" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>💵 Cash In</button>
              <button onClick={() => setCashInOutType("out")} className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${cashInOutType === "out" ? "bg-red-500 text-white shadow-lg" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>💸 Cash Out</button>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Jumlah (Rp)</label>
                <input type="number" value={cashInOutAmount} onChange={(e) => setCashInOutAmount(e.target.value)} placeholder="0" className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-lg font-bold font-mono" />
              </div>
              <div className="flex gap-2">
                {[10000, 20000, 50000, 100000].map((v) => (
                  <button key={v} onClick={() => setCashInOutAmount((parseInt(cashInOutAmount || "0") + v).toString())} className="flex-1 py-2 rounded-lg bg-gray-100 dark:bg-[#222] text-xs font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#333]">{formatRupiah(v)}</button>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Catatan</label>
                <input type="text" value={cashInOutNote} onChange={(e) => setCashInOutNote(e.target.value)} placeholder={cashInOutType === "in" ? "Uang tambahan dari modal..." : "Bayar listrik, sewa..."} className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowCashInOut(false)} className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 font-semibold">Batal</button>
              <button onClick={handleCashInOut} className={`flex-1 py-3 rounded-xl font-bold text-white ${cashInOutType === "in" ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"}`}>Simpan</button>
            </div>
            {/* Recent Cash In/Out */}
            {cashInOutList.length > 0 && (
              <div className="mt-4 border-t dark:border-[#333] pt-3 max-h-40 overflow-y-auto">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Riwayat Hari Ini</p>
                {cashInOutList.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${entry.type === "in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{entry.type === "in" ? "IN" : "OUT"}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]">{entry.note}</span>
                    </div>
                    <span className={`text-xs font-bold ${entry.type === "in" ? "text-green-600" : "text-red-600"}`}>{entry.type === "in" ? "+" : "-"}{formatRupiah(entry.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pre-Order Modal */}
      {showPreOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPreOrder(false)} />
          <div className="relative bg-white dark:bg-[#1a1a1a] rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="font-heading font-bold text-lg mb-1 dark:text-gray-100">📅 Pre-Order Event</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Pesan untuk acara dengan DP</p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Nama Acara *</label>
                <input type="text" value={preOrder.eventName} onChange={(e) => setPreOrder({ ...preOrder, eventName: e.target.value })} placeholder="Ulang Tahun, Resepsi..." className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Tanggal Acara</label>
                <input type="date" value={preOrder.eventDate} onChange={(e) => setPreOrder({ ...preOrder, eventDate: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">DP (Down Payment) *</label>
                <input type="number" value={preOrder.dpAmount || ""} onChange={(e) => setPreOrder({ ...preOrder, dpAmount: parseInt(e.target.value) || 0 })} placeholder="0" className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-[#444] dark:bg-[#222] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sabana text-lg font-bold font-mono" />
                <div className="flex gap-2 mt-2">
                  {[100000, 200000, 500000].map((v) => (
                    <button key={v} onClick={() => setPreOrder({ ...preOrder, dpAmount: v })} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${preOrder.dpAmount === v ? "bg-sabana text-white" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>{formatRupiah(v)}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Pelunasan</label>
                <div className="flex gap-2">
                  {["cash", "qris", "transfer"].map((m) => (
                    <button key={m} onClick={() => setPreOrder({ ...preOrder, remainingPayment: m })} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${preOrder.remainingPayment === m ? "bg-sabana text-white" : "bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400"}`}>{m === "cash" ? "💵 Tunai" : m === "qris" ? "📱 QRIS" : "🏦 Transfer"}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="bg-sabana-50 dark:bg-sabana/10 rounded-xl p-3 mb-4">
              <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-gray-400">Total Order</span><span className="font-bold text-gray-800 dark:text-gray-200">{formatRupiah(getTotal())}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-gray-400">DP</span><span className="font-bold text-sabana">-{formatRupiah(preOrder.dpAmount)}</span></div>
              <div className="flex justify-between text-sm font-bold border-t dark:border-[#444] mt-1 pt-1"><span className="text-gray-800 dark:text-gray-200">Sisa Pelunasan</span><span className="text-sabana">{formatRupiah(Math.max(0, getTotal() - preOrder.dpAmount))}</span></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowPreOrder(false)} className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-400 font-semibold">Batal</button>
              <button onClick={() => { setShowPreOrder(false); setPreOrder({ ...preOrder, isPreOrder: true }); }} disabled={!preOrder.eventName} className="flex-1 py-3 rounded-xl bg-sabana text-white font-bold disabled:opacity-50">Simpan Pre-Order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
