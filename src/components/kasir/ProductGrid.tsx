"use client";

import React from "react";
import clsx from "clsx";
import { Product } from "@/types";
import { formatRupiah } from "@/lib/format";

interface ProductGridProps {
  products: Product[];
  stock: Record<string, number>;
  onSelect: (product: Product) => void;
  searchQuery?: string;
}

export default function ProductGrid({
  products,
  stock,
  onSelect,
  searchQuery,
}: ProductGridProps) {
  const getStockStatus = (productId: string): "available" | "low" | "out" => {
    const qty = stock[productId] ?? 0;
    if (qty <= 0) return "out";
    if (qty <= 5) return "low";
    return "available";
  };

  const getStockColor = (status: "available" | "low" | "out") => {
    return { available: "bg-success", low: "bg-warning", out: "bg-danger" }[status];
  };

  const getStockLabel = (status: "available" | "low" | "out", qty: number) => {
    if (status === "out") return "Habis";
    if (status === "low") return `Sisa ${qty}`;
    return `${qty} ready`;
  };

  const filtered = searchQuery
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.sku?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : products;

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400">
        <div className="text-center">
          <span className="text-3xl block mb-1">🔍</span>
          <p className="text-xs font-medium">Produk tidak ditemukan</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-3 xl:grid-cols-4 gap-2">
      {filtered.map((product) => {
        const stockStatus = getStockStatus(product.id);
        const qty = stock[product.id] ?? 0;
        const isDisabled = stockStatus === "out";

        return (
          <button
            key={product.id}
            onClick={() => !isDisabled && onSelect(product)}
            disabled={isDisabled}
            className={clsx(
              "product-card p-2 bg-white border rounded-lg text-left",
              isDisabled
                ? "opacity-40 cursor-not-allowed border-gray-200"
                : "border-gray-200 hover:border-sabana"
            )}
          >
            {/* Product Icon/Image */}
            <div className="w-full aspect-square bg-sabana-50 rounded-md mb-1.5 flex items-center justify-center overflow-hidden">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl">🍗</span>
              )}
            </div>

            {/* Product Name */}
            <h3 className="font-semibold text-[11px] leading-tight text-gray-900 line-clamp-2 min-h-[2rem]">
              {product.name}
            </h3>

            {/* Price */}
            <p className="text-sabana font-bold text-sm mt-0.5">
              {formatRupiah(product.price)}
            </p>

            {/* Unit + Stock */}
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-gray-400">{product.unit}</span>
              <div className="flex items-center gap-1">
                <span className={clsx("w-1.5 h-1.5 rounded-full", getStockColor(stockStatus))} />
                <span
                  className={clsx("text-[10px] font-medium", {
                    "text-success": stockStatus === "available",
                    "text-yellow-600": stockStatus === "low",
                    "text-danger": stockStatus === "out",
                  })}
                >
                  {getStockLabel(stockStatus, qty)}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
