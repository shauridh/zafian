"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";

interface Product {
  id: string;
  name: string;
  category_id: string;
  price: number;
  hpp?: number;
  unit: string;
  sku?: string;
}

interface OrderItem {
  product_id: string;
  quantity: number;
  created_at: string;
}

interface ForecastData {
  product_id: string;
  product_name: string;
  avg_daily: number;
  current_stock: number;
  predicted_7day: number;
  predicted_30day: number;
  trend: "up" | "down" | "stable";
  trend_pct: number;
  suggested_reorder: number;
  reorder_priority: "urgent" | "soon" | "ok";
}

interface SalesDay {
  date: string;
  total_items: number;
  total_revenue: number;
}

const OUTLET_ID = "00000000-0000-0000-0000-000000000001";

export default function ForecastsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [stockData, setStockData] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [forecastDays, setForecastDays] = useState(30);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch all data
  useEffect(() => {
    async function fetchData() {
      try {
        // Products
        const { data: prods } = await supabase
          .from("products")
          .select("id, name, category_id, price, hpp, unit, sku")
          .eq("is_active", true)
          .order("name");

        // Order items (last 60 days for trend analysis)
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const { data: items } = await supabase
          .from("order_items")
          .select("product_id, quantity, created_at")
          .gte("created_at", sixtyDaysAgo.toISOString());

        // Finished goods stock
        const { data: stock } = await supabase
          .from("finished_goods")
          .select("product_id, quantity")
          .eq("outlet_id", OUTLET_ID);

        if (prods) setProducts(prods);
        if (items) setOrderItems(items);
        if (stock) {
          const stockMap: Record<string, number> = {};
          stock.forEach((s: any) => { stockMap[s.product_id] = s.quantity; });
          setStockData(stockMap);
        }
      } catch (err) {
        console.error("Error fetching forecast data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Calculate daily sales per product (last 30 days)
  const dailySalesPerProduct = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    orderItems.forEach((item) => {
      const date = item.created_at.split("T")[0];
      if (new Date(date) < thirtyDaysAgo) return;
      if (!map[item.product_id]) map[item.product_id] = {};
      map[item.product_id][date] = (map[item.product_id][date] || 0) + item.quantity;
    });

    return map;
  }, [orderItems]);

  // Calculate daily totals
  const dailyTotals: SalesDay[] = useMemo(() => {
    const map: Record<string, SalesDay> = {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Initialize all days
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i + 1);
      const dateStr = d.toISOString().split("T")[0];
      map[dateStr] = { date: dateStr, total_items: 0, total_revenue: 0 };
    }

    // Aggregate
    orderItems.forEach((item) => {
      const date = item.created_at.split("T")[0];
      if (map[date]) {
        map[date].total_items += item.quantity;
        const product = products.find((p) => p.id === item.product_id);
        if (product) map[date].total_revenue += product.price * item.quantity;
      }
    });

    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [orderItems, products]);

  // Generate forecasts
  const forecasts: ForecastData[] = useMemo(() => {
    return products.map((product) => {
      const sales = dailySalesPerProduct[product.id] || {};
      const salesValues = Object.values(sales);

      // Calculate average daily sales (last 30 days)
      const totalSold = salesValues.reduce((sum, v) => sum + v, 0);
      const activeDays = salesValues.filter((v) => v > 0).length || 1;
      const avgDaily = totalSold / 30;

      // Trend calculation (compare first half vs second half of 30 days)
      const firstHalf = Object.entries(sales)
        .filter(([date]) => {
          const d = new Date(date);
          const half = new Date();
          half.setDate(half.getDate() - 15);
          return d < half;
        })
        .reduce((sum, [, v]) => sum + v, 0);
      const secondHalf = Object.entries(sales)
        .filter(([date]) => {
          const d = new Date(date);
          const half = new Date();
          half.setDate(half.getDate() - 15);
          return d >= half;
        })
        .reduce((sum, [, v]) => sum + v, 0);

      let trend: "up" | "down" | "stable" = "stable";
      let trendPct = 0;
      if (firstHalf > 0) {
        trendPct = ((secondHalf - firstHalf) / firstHalf) * 100;
        if (trendPct > 10) trend = "up";
        else if (trendPct < -10) trend = "down";
      } else if (secondHalf > 0) {
        trend = "up";
        trendPct = 100;
      }

      // Predictions
      const predicted7Day = Math.ceil(avgDaily * 7);
      const predicted30Day = Math.ceil(avgDaily * 30);

      // Stock analysis
      const currentStock = stockData[product.id] || 0;
      const daysUntilOut = avgDaily > 0 ? Math.floor(currentStock / avgDaily) : 999;

      // Suggested reorder (2x predicted demand + safety stock)
      const safetyStock = Math.ceil(avgDaily * 3);
      const suggestedReorder = Math.max(0, predicted30Day + safetyStock - currentStock);

      // Priority
      let reorderPriority: "urgent" | "soon" | "ok" = "ok";
      if (daysUntilOut <= 3) reorderPriority = "urgent";
      else if (daysUntilOut <= 7) reorderPriority = "soon";

      return {
        product_id: product.id,
        product_name: product.name,
        avg_daily: avgDaily,
        current_stock: currentStock,
        predicted_7day: predicted7Day,
        predicted_30day: predicted30Day,
        trend,
        trend_pct: trendPct,
        suggested_reorder: suggestedReorder,
        reorder_priority: reorderPriority,
      };
    });
  }, [products, dailySalesPerProduct, stockData]);

  const filteredForecasts = useMemo(() => {
    let list = forecasts;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((f) => f.product_name.toLowerCase().includes(q));
    }
    // Sort by priority
    return list.sort((a, b) => {
      const priority = { urgent: 0, soon: 1, ok: 2 };
      return priority[a.reorder_priority] - priority[b.reorder_priority];
    });
  }, [forecasts, searchQuery]);

  const stats = useMemo(() => ({
    totalProducts: forecasts.length,
    urgent: forecasts.filter((f) => f.reorder_priority === "urgent").length,
    soon: forecasts.filter((f) => f.reorder_priority === "soon").length,
    ok: forecasts.filter((f) => f.reorder_priority === "ok").length,
    avgDailyTotal: forecasts.reduce((sum, f) => sum + f.avg_daily, 0),
  }), [forecasts]);

  const getTrendIcon = (trend: string) => {
    if (trend === "up") return { icon: "📈", color: "text-success" };
    if (trend === "down") return { icon: "📉", color: "text-danger" };
    return { icon: "➡️", color: "text-gray-400" };
  };

  const getPriorityColor = (p: string) => {
    if (p === "urgent") return "bg-red-100 text-red-700 border-red-200";
    if (p === "soon") return "bg-yellow-100 text-yellow-700 border-yellow-200";
    return "bg-green-100 text-green-700 border-green-200";
  };

  const getPriorityLabel = (p: string) => {
    if (p === "urgent") return "🚨 Urgent";
    if (p === "soon") return "⚠️ Segera";
    return "✅ Aman";
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-gray-500">Menghitung forecast...</p>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900">📈 Inventory Forecasting</h1>
          <p className="text-gray-500 text-sm mt-0.5">Prediksi permintaan berdasarkan tren penjualan</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {[
          { label: "Total Produk", value: stats.totalProducts, color: "text-gray-900" },
          { label: "Urgent", value: stats.urgent, color: "text-danger" },
          { label: "Segera", value: stats.soon, color: "text-yellow-600" },
          { label: "Aman", value: stats.ok, color: "text-success" },
          { label: "Penjualan/Hari", value: Math.round(stats.avgDailyTotal), color: "text-sabana" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Sales Trend Mini Chart */}
      <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm mb-4">
        <h3 className="text-sm font-semibold text-gray-600 mb-3">📊 Tren Penjualan 30 Hari</h3>
        <div className="flex items-end gap-0.5 h-20">
          {dailyTotals.map((day) => {
            const maxItems = Math.max(...dailyTotals.map((d) => d.total_items), 1);
            const height = (day.total_items / maxItems) * 100;
            return (
              <div key={day.date} className="flex-1 group relative" title={`${day.date}: ${day.total_items} item, ${formatRupiah(day.total_revenue)}`}>
                <div
                  className={`w-full rounded-t transition-all ${day.total_items > maxItems * 0.7 ? "bg-sabana" : day.total_items > maxItems * 0.3 ? "bg-sabana/60" : "bg-sabana/30"}`}
                  style={{ height: `${Math.max(height, 2)}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] text-gray-400 mt-1">
          <span>{dailyTotals[0]?.date ? new Date(dailyTotals[0].date).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : ""}</span>
          <span>Hari ini</span>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm mb-4">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" placeholder="Cari produk..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-sabana text-sm" />
        </div>
      </div>

      {/* Forecast Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Produk</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Stok</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Rata2/Hari</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Prediksi 7 Hari</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Prediksi 30 Hari</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Tren</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Saran Pesan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredForecasts.map((f) => {
                const trendInfo = getTrendIcon(f.trend);
                return (
                  <tr key={f.product_id} className={`hover:bg-gray-50 transition-colors ${f.reorder_priority === "urgent" ? "bg-red-50/50" : ""}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{f.product_name}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-bold ${f.current_stock <= 0 ? "text-danger" : f.current_stock <= 10 ? "text-yellow-600" : "text-gray-900"}`}>
                        {f.current_stock}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{f.avg_daily.toFixed(1)}</td>
                    <td className="px-4 py-3 text-center font-medium text-gray-900">{f.predicted_7day}</td>
                    <td className="px-4 py-3 text-center font-medium text-gray-900">{f.predicted_30day}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-sm ${trendInfo.color}`}>
                        {trendInfo.icon} {f.trend_pct > 0 ? `+${f.trend_pct.toFixed(0)}%` : f.trend_pct.toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${getPriorityColor(f.reorder_priority)}`}>
                        {getPriorityLabel(f.reorder_priority)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {f.suggested_reorder > 0 ? (
                        <span className="font-bold text-sabana">{f.suggested_reorder} unit</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredForecasts.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <span className="text-3xl block mb-2">📈</span>
            <p className="text-sm">Belum ada data penjualan untuk forecast</p>
          </div>
        )}
      </div>
    </div>
  );
}
