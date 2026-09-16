"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";

interface Product {
  id: string;
  name: string;
  category_id: string;
  price: number;
  unit: string;
  sku?: string;
  image_url?: string;
}

interface Category {
  id: string;
  name: string;
  icon: string;
}

interface FinishedGood {
  id: string;
  product_id: string;
  outlet_id: string;
  quantity: number;
  min_quantity: number;
  updated_at: string;
}

interface StockAlert {
  product_id: string;
  product_name: string;
  quantity: number;
  min_quantity: number;
  status: "out" | "low" | "ok";
}

const OUTLET_ID = "00000000-0000-0000-0000-000000000001";

export default function StockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stock, setStock] = useState<FinishedGood[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showAdjustModal, setShowAdjustModal] = useState<string | null>(null);
  const [adjustValue, setAdjustValue] = useState(0);
  const [adjustType, setAdjustType] = useState<"set" | "add" | "subtract">("set");
  const [adjustNotes, setAdjustNotes] = useState("");

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        const [prodRes, catRes, stockRes] = await Promise.all([
          supabase.from("products").select("id, name, category_id, price, unit, sku, image_url").eq("is_active", true).order("name"),
          supabase.from("categories").select("id, name, icon").eq("is_active", true).order("sort_order"),
          supabase.from("finished_goods").select("*").eq("outlet_id", OUTLET_ID),
        ]);

        if (prodRes.data) setProducts(prodRes.data);
        if (catRes.data) setCategories(catRes.data);
        if (stockRes.data) setStock(stockRes.data);
      } catch (err) {
        console.error("Error fetching stock data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Merge products with stock data
  const stockData = useMemo(() => {
    return products.map((product) => {
      const stockItem = stock.find((s) => s.product_id === product.id);
      const category = categories.find((c) => c.id === product.category_id);
      return {
        ...product,
        quantity: stockItem?.quantity || 0,
        min_quantity: stockItem?.min_quantity || 0,
        has_stock_record: !!stockItem,
        stock_record_id: stockItem?.id,
        category_name: category?.name || "-",
        category_icon: category?.icon || "📦",
      };
    });
  }, [products, stock, categories]);

  // Filter
  const filteredStock = useMemo(() => {
    let list = stockData;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q) || s.sku?.toLowerCase().includes(q));
    }
    if (selectedCategory) {
      list = list.filter((s) => s.category_id === selectedCategory);
    }
    return list;
  }, [stockData, searchQuery, selectedCategory]);

  // Alerts
  const alerts: StockAlert[] = useMemo(() => {
    return stockData
      .filter((s) => s.quantity <= s.min_quantity)
      .map((s) => ({
        product_id: s.id,
        product_name: s.name,
        quantity: s.quantity,
        min_quantity: s.min_quantity,
        status: s.quantity <= 0 ? "out" : s.quantity <= s.min_quantity ? "low" : "ok",
      }));
  }, [stockData]);

  const outOfStock = alerts.filter((a) => a.status === "out");
  const lowStock = alerts.filter((a) => a.status === "low");

  // Stock stats
  const stats = useMemo(() => ({
    totalProducts: products.length,
    inStock: stockData.filter((s) => s.quantity > s.min_quantity).length,
    lowStock: lowStock.length,
    outOfStock: outOfStock.length,
    totalValue: stockData.reduce((sum, s) => sum + s.quantity, 0),
  }), [stockData, lowStock, outOfStock, products]);

  // Handle stock adjustment
  const handleAdjust = async (productId: string) => {
    setSaving(true);
    try {
      const product = stockData.find((s) => s.id === productId);
      if (!product) return;

      let newQuantity = adjustValue;
      if (adjustType === "add") newQuantity = product.quantity + adjustValue;
      if (adjustType === "subtract") newQuantity = Math.max(0, product.quantity - adjustValue);

      // Upsert finished_goods
      const { error } = await supabase.from("finished_goods").upsert(
        {
          product_id: productId,
          outlet_id: OUTLET_ID,
          quantity: newQuantity,
          min_quantity: product.min_quantity || 10,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "product_id,outlet_id" }
      );

      if (error) throw error;

      // Log to stock_ledger
      await supabase.from("stock_ledger").insert({
        product_id: productId,
        type: "adjustment",
        quantity: newQuantity - product.quantity,
        reference_type: "adjustment",
        notes: adjustNotes || `Penyesuaian stok: ${adjustType}`,
        outlet_id: OUTLET_ID,
        created_at: new Date().toISOString(),
      });

      // Update local state
      setStock((prev) => {
        const existing = prev.find((s) => s.product_id === productId);
        if (existing) {
          return prev.map((s) =>
            s.product_id === productId ? { ...s, quantity: newQuantity, updated_at: new Date().toISOString() } : s
          );
        }
        return [...prev, { id: `fg-${Date.now()}`, product_id: productId, outlet_id: OUTLET_ID, quantity: newQuantity, min_quantity: 10, updated_at: new Date().toISOString() }];
      });

      setShowAdjustModal(null);
      setAdjustValue(0);
      setAdjustNotes("");
    } catch (err) {
      console.error("Error adjusting stock:", err);
      alert("Gagal menyesuaikan stok");
    } finally {
      setSaving(false);
    }
  };

  // Set min stock
  const handleSetMinStock = async (productId: string, minQuantity: number) => {
    try {
      const existing = stock.find((s) => s.product_id === productId);
      await supabase.from("finished_goods").upsert(
        {
          product_id: productId,
          outlet_id: OUTLET_ID,
          quantity: existing?.quantity || 0,
          min_quantity: minQuantity,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "product_id,outlet_id" }
      );

      setStock((prev) =>
        prev.map((s) =>
          s.product_id === productId ? { ...s, min_quantity: minQuantity } : s
        )
      );
    } catch (err) {
      console.error("Error setting min stock:", err);
    }
  };

  const getStockStatus = (qty: number, min: number): "ok" | "low" | "out" => {
    if (qty <= 0) return "out";
    if (qty <= min) return "low";
    return "ok";
  };

  const getStockColor = (status: "ok" | "low" | "out") => {
    return { ok: "text-success", low: "text-warning", out: "text-danger" }[status];
  };

  const getStockBg = (status: "ok" | "low" | "out") => {
    return { ok: "bg-green-50 border-green-200", low: "bg-yellow-50 border-yellow-200", out: "bg-red-50 border-red-200" }[status];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Memuat data stok...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900">📊 Manajemen Stok</h1>
          <p className="text-gray-500 text-sm mt-0.5">Kelola stok produk jadi (finished goods)</p>
        </div>
      </div>

      {/* Alerts Banner */}
      {(outOfStock.length > 0 || lowStock.length > 0) && (
        <div className="mb-4 space-y-2">
          {outOfStock.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
              <span className="text-lg">🚨</span>
              <div>
                <p className="text-sm font-semibold text-red-800">Stok Habis ({outOfStock.length})</p>
                <p className="text-xs text-red-600 mt-0.5">
                  {outOfStock.map((a) => a.product_name).slice(0, 3).join(", ")}
                  {outOfStock.length > 3 && ` +${outOfStock.length - 3} lagi`}
                </p>
              </div>
            </div>
          )}
          {lowStock.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 flex items-start gap-3">
              <span className="text-lg">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-yellow-800">Stok Menipis ({lowStock.length})</p>
                <p className="text-xs text-yellow-600 mt-0.5">
                  {lowStock.map((a) => `${a.product_name} (sisa ${a.quantity})`).slice(0, 3).join(", ")}
                  {lowStock.length > 3 && ` +${lowStock.length - 3} lagi`}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {[
          { label: "Total Produk", value: stats.totalProducts, color: "text-gray-900" },
          { label: "Stok Aman", value: stats.inStock, color: "text-success" },
          { label: "Menipis", value: stats.lowStock, color: "text-warning" },
          { label: "Habis", value: stats.outOfStock, color: "text-danger" },
          { label: "Total Unit", value: stats.totalValue.toLocaleString("id-ID"), color: "text-sabana" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Cari produk atau SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm"
            />
          </div>
          <select
            value={selectedCategory || ""}
            onChange={(e) => setSelectedCategory(e.target.value || null)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sabana"
          >
            <option value="">Semua Kategori</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Produk</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">SKU</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Stok</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Min Stok</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredStock.map((item) => {
                const status = getStockStatus(item.quantity, item.min_quantity);
                return (
                  <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${status === "out" ? "bg-red-50/50" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{item.category_icon}</span>
                        <div>
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.category_name} · {item.unit}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.sku || "-"}</td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => {
                          const newQty = parseInt(e.target.value) || 0;
                          setStock((prev) => prev.map((s) => s.product_id === item.id ? { ...s, quantity: newQty } : s));
                        }}
                        onBlur={async () => {
                          const existing = stock.find((s) => s.product_id === item.id);
                          if (existing) {
                            await supabase.from("finished_goods").upsert(
                              { product_id: item.id, outlet_id: OUTLET_ID, quantity: item.quantity, min_quantity: item.min_quantity, updated_at: new Date().toISOString() },
                              { onConflict: "product_id,outlet_id" }
                            );
                          }
                        }}
                        className={`w-20 text-center font-bold py-1.5 rounded-lg border-2 focus:outline-none focus:border-sabana ${
                          status === "out" ? "border-red-300 bg-red-50 text-danger" : status === "low" ? "border-yellow-300 bg-yellow-50 text-yellow-700" : "border-gray-200 bg-white text-gray-900"
                        }`}
                        min={0}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="number"
                        value={item.min_quantity}
                        onChange={(e) => {
                          const newMin = parseInt(e.target.value) || 0;
                          setStock((prev) => prev.map((s) => s.product_id === item.id ? { ...s, min_quantity: newMin } : s));
                        }}
                        onBlur={() => handleSetMinStock(item.id, item.min_quantity)}
                        className="w-16 text-center text-sm py-1 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana"
                        min={0}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${getStockBg(status)}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status === "ok" ? "bg-success" : status === "low" ? "bg-warning" : "bg-danger"}`} />
                        {status === "ok" ? "Aman" : status === "low" ? "Menipis" : "Habis"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { setShowAdjustModal(item.id); setAdjustValue(item.quantity); setAdjustType("set"); }}
                        className="px-3 py-1.5 text-xs font-medium bg-sabana text-white rounded-lg hover:bg-sabana-dark transition-colors"
                      >
                        Sesuaikan
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredStock.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <span className="text-3xl block mb-2">📦</span>
            <p className="text-sm">Tidak ada produk ditemukan</p>
          </div>
        )}
      </div>

      {/* Adjust Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-heading font-bold text-lg text-gray-900 mb-1">📦 Sesuaikan Stok</h3>
            <p className="text-sm text-gray-500 mb-4">
              {stockData.find((s) => s.id === showAdjustModal)?.name}
            </p>

            <div className="flex gap-2 mb-4">
              {(["set", "add", "subtract"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setAdjustType(type)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                    adjustType === type
                      ? "border-sabana bg-sabana-50 text-sabana"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  {type === "set" ? "Atur" : type === "add" ? "+ Tambah" : "- Kurang"}
                </button>
              ))}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">Jumlah</label>
              <input
                type="number"
                value={adjustValue}
                onChange={(e) => setAdjustValue(parseInt(e.target.value) || 0)}
                className="w-full text-center text-2xl font-bold py-3 rounded-xl border-2 border-gray-200 focus:outline-none focus:border-sabana"
                min={0}
                autoFocus
              />
              <p className="text-xs text-gray-400 text-center mt-1">
                {adjustType === "set" && `Stok baru: ${adjustValue}`}
                {adjustType === "add" && `Stok baru: ${(stockData.find((s) => s.id === showAdjustModal)?.quantity || 0) + adjustValue}`}
                {adjustType === "subtract" && `Stok baru: ${Math.max(0, (stockData.find((s) => s.id === showAdjustModal)?.quantity || 0) - adjustValue)}`}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">Catatan (opsional)</label>
              <input
                type="text"
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder="Contoh: Produksi, Rusak, dll"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sabana"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setShowAdjustModal(null); setAdjustNotes(""); }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={() => handleAdjust(showAdjustModal)}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-sabana text-white font-semibold hover:bg-sabana-dark transition-colors disabled:opacity-50"
              >
                {saving ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
