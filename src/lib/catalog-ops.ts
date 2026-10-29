import { mergeIngredientUsage, type Ingredient } from '../domain/catalog'
import type { PosStore } from '../domain/pos'
import { createId } from './id'

/**
 * Simpan pemakaian standar beberapa bahan sekaligus. Dipakai dialog
 * "Atur standar" agar gramasi semua bahan bisa diisi satu kali, bukan per bahan.
 */
export function applyIngredientUsageBulk(
  store: PosStore,
  input: Record<string, string | number>,
): { store: PosStore; set: number; cleared: number } {
  const { usage, set, cleared } = mergeIngredientUsage(
    store.settings.ingredientUsage ?? {},
    input,
    store.ingredients.map((item) => item.id),
  )
  if (set === 0 && cleared === 0) return { store, set, cleared }
  return {
    store: {
      ...store,
      settings: { ...store.settings, ingredientUsage: usage },
      auditLog: [...store.auditLog, {
        id: createId(),
        createdAt: new Date().toISOString(),
        action: 'settings_update' as const,
        detail: `Pemakaian standar ${set} bahan${cleared > 0 ? ` • ${cleared} dikosongkan` : ''}`,
      }],
    },
    set,
    cleared,
  }
}

/**
 * Hapus bahan dari katalog sekaligus lepaskan dari semua resep menu.
 *
 * Tanpa pelepasan resep, baris resep akan menunjuk bahan yang tidak ada lagi
 * (HPP 0 dan editor resep menampilkan pilihan kosong). Riwayat pembelian,
 * opname, dan transaksi tetap utuh karena ledger bersifat append-only.
 */
export function removeIngredient(store: PosStore, ingredient: Ingredient): { store: PosStore; detachedFrom: number } {
  let detachedFrom = 0
  const menus = store.menus.map((menu) => {
    if (!menu.recipe.some((line) => line.ingredientId === ingredient.id)) return menu
    detachedFrom += 1
    return { ...menu, recipe: menu.recipe.filter((line) => line.ingredientId !== ingredient.id) }
  })
  const ingredientUsage = { ...(store.settings.ingredientUsage ?? {}) }
  delete ingredientUsage[ingredient.id]
  return {
    store: {
      ...store,
      settings: { ...store.settings, ingredientUsage },
      ingredients: store.ingredients.filter((item) => item.id !== ingredient.id),
      menus,
      auditLog: [...store.auditLog, {
        id: createId(),
        createdAt: new Date().toISOString(),
        action: 'ingredient_delete' as const,
        detail: detachedFrom > 0 ? `${ingredient.name} • lepas dari ${detachedFrom} resep` : ingredient.name,
      }],
    },
    detachedFrom,
  }
}
