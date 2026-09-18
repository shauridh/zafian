"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";

interface Recipe {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  inputs: { ingredient_id: string; ingredient_name: string; quantity: number; unit: string }[];
  outputs: { product_id: string; product_name: string; quantity: number; unit: string }[];
}

interface ProductionRecord {
  id: string;
  recipe_name: string;
  input_quantity: number;
  status: string;
  produced_by_name: string;
  created_at: string;
  completed_at: string | null;
  notes: string;
  outputs_summary: string;
}

const OUTLET_ID = "00000000-0000-0000-0000-000000000001";

export default function ProductionPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [productionHistory, setProductionHistory] = useState<ProductionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [batchQty, setBatchQty] = useState(1);
  const [producing, setProducing] = useState(false);
  const [produced, setProduced] = useState(false);
  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeDescription, setRecipeDescription] = useState("");
  const [recipeIngredients, setRecipeIngredients] = useState<{ ingredient_id: string; quantity: number }[]>([{ ingredient_id: "", quantity: 0 }]);
  const [recipeOutputs, setRecipeOutputs] = useState<{ product_id: string; quantity: number }[]>([{ product_id: "", quantity: 0 }]);
  const [ingredientOptions, setIngredientOptions] = useState<{ id: string; name: string; unit: string }[]>([]);
  const [productOptions, setProductOptions] = useState<{ id: string; name: string; unit: string }[]>([]);
  const [savingRecipe, setSavingRecipe] = useState(false);

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        // Recipes
        const { data: recipeData } = await supabase
          .from("production_recipes")
          .select("*")
          .eq("is_active", true);

        // Recipe inputs
        const { data: inputsData } = await supabase
          .from("recipe_inputs")
          .select("*, ingredients(name, unit)");

        // Recipe outputs
        const { data: outputsData } = await supabase
          .from("recipe_outputs")
          .select("*, products(name, unit)");

        // Production history
        const { data: historyData } = await supabase
          .from("production_orders")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20);

        // Enrich recipes
        const enrichedRecipes: Recipe[] = (recipeData || []).map((r: any) => ({
          id: r.id,
          name: r.name,
          description: r.description || "",
          is_active: r.is_active,
          inputs: (inputsData || [])
            .filter((i: any) => i.recipe_id === r.id)
            .map((i: any) => ({
              ingredient_id: i.ingredient_id,
              ingredient_name: i.ingredients?.name || "Unknown",
              quantity: i.quantity,
              unit: i.ingredients?.unit || "pcs",
            })),
          outputs: (outputsData || [])
            .filter((o: any) => o.recipe_id === r.id)
            .map((o: any) => ({
              product_id: o.product_id,
              product_name: o.products?.name || "Unknown",
              quantity: o.quantity,
              unit: o.products?.unit || "pcs",
            })),
        }));

        // Enrich history
        const enrichedHistory: ProductionRecord[] = (historyData || []).map((h: any) => {
          const recipe = enrichedRecipes.find((r) => r.id === h.recipe_id);
          const outputs = recipe?.outputs.map((o) => `${o.product_name}: ${o.quantity * h.input_quantity}`).join(", ") || "";
          return {
            id: h.id,
            recipe_name: recipe?.name || "Unknown",
            input_quantity: h.input_quantity,
            status: h.status,
            produced_by_name: "Kasir",
            created_at: h.created_at,
            completed_at: h.completed_at,
            notes: h.notes || "",
            outputs_summary: outputs,
          };
        });

        setRecipes(enrichedRecipes);
        setProductionHistory(enrichedHistory);
        if (enrichedRecipes.length > 0) setSelectedRecipe(enrichedRecipes[0]);
      } catch (err) {
        console.error("Error fetching production data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    Promise.all([
      supabase.from("ingredients").select("id,name,unit,usage_unit").eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,unit").eq("is_active", true).order("name"),
    ]).then(([ingredientsResult, productsResult]) => {
      setIngredientOptions((ingredientsResult.data || []) as { id: string; name: string; unit: string }[]);
      setProductOptions((productsResult.data || []) as { id: string; name: string; unit: string }[]);
    });
  }, []);

  const saveRecipe = async (event: React.FormEvent) => {
    event.preventDefault();
    const inputs = recipeIngredients.filter((item) => item.ingredient_id && item.quantity > 0);
    const outputs = recipeOutputs.filter((item) => item.product_id && item.quantity > 0);
    if (!recipeName.trim() || !inputs.length || !outputs.length) {
      alert("Isi nama resep, minimal satu bahan input, dan minimal satu produk output.");
      return;
    }
    setSavingRecipe(true);
    try {
      const { data: recipe, error: recipeError } = await supabase.from("production_recipes").insert({ name: recipeName.trim(), description: recipeDescription.trim(), is_active: true }).select("id").single();
      if (recipeError || !recipe) throw recipeError || new Error("Resep gagal dibuat");
      const { error: inputError } = await supabase.from("recipe_inputs").insert(inputs.map((item) => ({ recipe_id: recipe.id, ingredient_id: item.ingredient_id, quantity: item.quantity })));
      if (inputError) throw inputError;
      const { error: outputError } = await supabase.from("recipe_outputs").insert(outputs.map((item) => ({ recipe_id: recipe.id, product_id: item.product_id, quantity: item.quantity })));
      if (outputError) throw outputError;
      setShowRecipeForm(false);
      setRecipeName(""); setRecipeDescription("");
      setRecipeIngredients([{ ingredient_id: "", quantity: 0 }]); setRecipeOutputs([{ product_id: "", quantity: 0 }]);
      window.location.reload();
    } catch (error) {
      alert(`Gagal menyimpan resep: ${error instanceof Error ? error.message : "error tidak diketahui"}`);
    } finally { setSavingRecipe(false); }
  };

  // Start production through the atomic database function. This prevents a
  // partial batch when one ingredient is short or a stock write fails.
  const handleStartProduction = async () => {
    if (!selectedRecipe || batchQty < 1) return;
    setProducing(true);

    try {
      const { data: prodOrderId, error: productionError } = await supabase.rpc("complete_production", {
        p_outlet_id: OUTLET_ID,
        p_recipe_id: selectedRecipe.id,
        p_batch_quantity: batchQty,
        p_actor_id: null,
        p_notes: `Produksi: ${selectedRecipe.name} × ${batchQty}`,
      });
      if (productionError) throw productionError;

      const outputsSummary = selectedRecipe.outputs
        .map((o) => `${o.product_name}: ${o.quantity * batchQty}`)
        .join(", ");

      setProductionHistory((prev) => [
        {
          id: prodOrderId || Date.now().toString(),
          recipe_name: selectedRecipe.name,
          input_quantity: batchQty,
          status: "completed",
          produced_by_name: "Kasir",
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          notes: "",
          outputs_summary: outputsSummary,
        },
        ...prev,
      ]);

      setProduced(true);
      setTimeout(() => setProduced(false), 3000);
    } catch (err) {
      console.error("Production error:", err);
      alert("Gagal memproses produksi");
    } finally {
      setProducing(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-heading font-bold text-gray-900">🏭 Menu Produksi</h1>
        <p className="text-gray-500 text-sm mt-0.5">Konversi bahan mentah menjadi bahan jadi (etalase)</p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setShowRecipeForm(!showRecipeForm)} className="px-4 py-2 rounded-xl bg-sabana text-white text-sm font-semibold hover:bg-sabana-dark">+ Tambah Resep Produksi</button>
      </div>

      {showRecipeForm && (
        <form onSubmit={saveRecipe} className="rounded-2xl border border-sabana/20 bg-sabana-50 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4"><div><h2 className="font-heading font-semibold text-gray-900">Tambah Resep Produksi</h2><p className="text-xs text-gray-500 mt-1">Input mengurangi bahan baku; output menambah stok produk jadi.</p></div><button type="button" onClick={() => setShowRecipeForm(false)} className="text-gray-400">✕</button></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4"><input required value={recipeName} onChange={(event) => setRecipeName(event.target.value)} placeholder="Nama resep, contoh: Adonan Crispy" className="px-3 py-2 rounded-xl border border-gray-200" /><input value={recipeDescription} onChange={(event) => setRecipeDescription(event.target.value)} placeholder="Deskripsi (opsional)" className="px-3 py-2 rounded-xl border border-gray-200" /></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div><h3 className="text-sm font-semibold mb-2">Bahan Input</h3>{recipeIngredients.map((line, index) => <div key={index} className="flex gap-2 mb-2"><select required value={line.ingredient_id} onChange={(event) => setRecipeIngredients((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ingredient_id: event.target.value } : item))} className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm"><option value="">Pilih bahan</option>{ingredientOptions.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select><input required type="number" min="0.001" step="0.001" value={line.quantity || ""} onChange={(event) => setRecipeIngredients((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} placeholder="Qty" className="w-24 px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>)}<button type="button" onClick={() => setRecipeIngredients((current) => [...current, { ingredient_id: "", quantity: 0 }])} className="text-xs font-semibold text-sabana">+ Tambah bahan</button></div>
            <div><h3 className="text-sm font-semibold mb-2">Produk Output</h3>{recipeOutputs.map((line, index) => <div key={index} className="flex gap-2 mb-2"><select required value={line.product_id} onChange={(event) => setRecipeOutputs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, product_id: event.target.value } : item))} className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm"><option value="">Pilih produk</option>{productOptions.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select><input required type="number" min="1" step="1" value={line.quantity || ""} onChange={(event) => setRecipeOutputs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} placeholder="Qty" className="w-24 px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>)}<button type="button" onClick={() => setRecipeOutputs((current) => [...current, { product_id: "", quantity: 0 }])} className="text-xs font-semibold text-sabana">+ Tambah output</button></div>
          </div>
          <button type="submit" disabled={savingRecipe} className="mt-5 px-5 py-2.5 rounded-xl bg-success text-white font-semibold disabled:opacity-50">{savingRecipe ? "Menyimpan..." : "Simpan Resep"}</button>
        </form>
      )}

      {/* Success Banner */}
      {produced && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center animate-bounce">
          <p className="text-sm font-semibold text-green-800">✅ Produksi selesai! Stok finished goods sudah bertambah.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recipe Selection */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
          <h3 className="font-heading font-semibold text-gray-900 mb-3">Pilih Resep Konversi</h3>
          <div className="space-y-2">
            {recipes.map((recipe) => (
              <button
                key={recipe.id}
                onClick={() => setSelectedRecipe(recipe)}
                className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                  selectedRecipe?.id === recipe.id
                    ? "border-sabana bg-sabana-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-sm text-gray-900">{recipe.name}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Input: {recipe.inputs.map((i) => `${i.quantity} ${i.unit} ${i.ingredient_name}`).join(", ") || "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-sabana font-bold text-sm">{recipe.outputs.reduce((s, o) => s + o.quantity, 0)} output</span>
                  </div>
                </div>
              </button>
            ))}
            {recipes.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Belum ada resep produksi</p>
            )}
          </div>
        </div>

        {/* Production Form */}
        {selectedRecipe && (
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
            <h3 className="font-heading font-semibold text-gray-900 mb-3">Konfigurasi Produksi</h3>

            <div className="bg-gray-50 rounded-xl p-3 mb-3">
              <h4 className="font-semibold text-sm mb-2">{selectedRecipe.name}</h4>
              <div className="mb-2">
                <p className="text-xs text-gray-500 mb-1">📦 INPUT:</p>
                {selectedRecipe.inputs.map((input, idx) => (
                  <div key={idx} className="flex items-center justify-between ml-3 text-sm">
                    <span>{input.ingredient_name}</span>
                    <span className="font-mono text-xs">{input.quantity} {input.unit} × {batchQty} = {input.quantity * batchQty}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">📤 OUTPUT:</p>
                {selectedRecipe.outputs.map((output, idx) => (
                  <div key={idx} className="flex items-center justify-between ml-3 text-sm">
                    <span>{output.product_name}</span>
                    <span className="font-mono text-xs text-success font-bold">{output.quantity * batchQty} {output.unit}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-600 mb-1">Jumlah Batch</label>
              <div className="flex items-center gap-3">
                <button onClick={() => setBatchQty(Math.max(1, batchQty - 1))} className="w-10 h-10 rounded-xl border-2 border-gray-200 flex items-center justify-center text-lg font-bold hover:border-sabana transition-colors">−</button>
                <input type="number" value={batchQty} onChange={(e) => setBatchQty(Math.max(1, parseInt(e.target.value) || 1))} className="w-20 text-center text-xl font-bold py-1.5 rounded-xl border-2 border-gray-200 focus:outline-none focus:border-sabana" />
                <button onClick={() => setBatchQty(batchQty + 1)} className="w-10 h-10 rounded-xl border-2 border-gray-200 flex items-center justify-center text-lg font-bold hover:border-sabana transition-colors">+</button>
              </div>
            </div>

            <button
              onClick={handleStartProduction}
              disabled={producing}
              className="w-full py-3 bg-success text-white rounded-xl font-bold hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {producing ? "Memproses..." : "✅ MULAI PRODUKSI"}
            </button>
          </div>
        )}
      </div>

      {/* History */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
        <h3 className="font-heading font-semibold text-gray-900 mb-3">📜 Riwayat Produksi</h3>
        {productionHistory.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Belum ada riwayat produksi</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Waktu</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Resep</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Batch</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Output</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {productionHistory.map((prod) => (
                  <tr key={prod.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">{new Date(prod.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-3 py-2 text-xs font-medium">{prod.recipe_name}</td>
                    <td className="px-3 py-2 text-xs">{prod.input_quantity}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 max-w-[200px] truncate">{prod.outputs_summary}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">✓ Selesai</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
