import type { Ingredient, Menu, RecipeLine } from './catalog'
import type { CartItem, Transaction } from './pos'

export type StockMovementType = 'purchase' | 'adjustment' | 'opname'

export type StockMovement = {
  id: string
  createdAt: string
  ingredientId: string
  type: StockMovementType
  /** Positif menambah stok, negatif untuk penyesuaian keluar. */
  qty: number
  totalCost: number
  note: string
  /** Khusus opname: biaya per satuan saat penghitungan, dipakai untuk jurnal. */
  unitCost?: number
  /** Khusus opname: stok fisik hasil hitung. */
  countedQty?: number
  /** Khusus opname: stok sistem saat penghitungan (snapshot). */
  systemQty?: number
}

export type UsageRow = {
  ingredientId: string
  name: string
  unit: string
  used: number
  stock: number
  minStock: number
  dailyNeed: number
  weeklyNeed: number
  purchaseQty: number
}

const completed = (transaction: Transaction) => transaction.status === 'completed'

function recipeFor(item: CartItem, menus: Menu[]): RecipeLine[] {
  return menus.find((menu) => menu.id === item.id)?.recipe ?? []
}

/** Pemakaian bahan teoretis dari transaksi selesai. */
export function usageFromTransactions(transactions: Transaction[], menus: Menu[]): Map<string, number> {
  const usage = new Map<string, number>()
  for (const transaction of transactions.filter(completed)) {
    for (const item of transaction.items) {
      for (const line of recipeFor(item, menus)) {
        usage.set(line.ingredientId, (usage.get(line.ingredientId) ?? 0) + line.qty * item.qty)
      }
    }
  }
  return usage
}

export function stockFromMovements(ingredientId: string, movements: StockMovement[]): number {
  return movements.filter((movement) => movement.ingredientId === ingredientId).reduce((sum, movement) => sum + movement.qty, 0)
}

export function stockLevel(ingredientId: string, movements: StockMovement[], usage: Map<string, number>): number {
  return stockFromMovements(ingredientId, movements) - (usage.get(ingredientId) ?? 0)
}

/** Rata-rata pemakaian harian berdasarkan transaksi N hari terakhir. */
export function averageDailyUsage(transactions: Transaction[], menus: Menu[], days = 7): Map<string, number> {
  const now = Date.now()
  const windowMs = Math.max(1, days) * 24 * 60 * 60 * 1000
  const recent = transactions.filter((transaction) => completed(transaction) && now - new Date(transaction.createdAt).getTime() <= windowMs)
  const usage = usageFromTransactions(recent, menus)
  const divisor = Math.max(1, days)
  const daily = new Map<string, number>()
  for (const [ingredientId, qty] of usage.entries()) daily.set(ingredientId, qty / divisor)
  return daily
}

export function inventoryRows(ingredients: Ingredient[], menus: Menu[], transactions: Transaction[], movements: StockMovement[], days = 7): UsageRow[] {
  const usage = usageFromTransactions(transactions, menus)
  const daily = averageDailyUsage(transactions, menus, days)
  return ingredients.map((ingredient) => {
    const dailyNeed = daily.get(ingredient.id) ?? 0
    const weeklyNeed = dailyNeed * 7
    const stock = stockLevel(ingredient.id, movements, usage)
    const purchaseQty = ingredient.usagePerPurchaseUnit > 0 ? Math.max(0, Math.ceil((weeklyNeed + ingredient.minStock - stock) / ingredient.usagePerPurchaseUnit)) : 0
    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      used: usage.get(ingredient.id) ?? 0,
      stock,
      minStock: ingredient.minStock,
      dailyNeed,
      weeklyNeed,
      purchaseQty,
    }
  })
}

export function inventoryValue(ingredients: Ingredient[], movements: StockMovement[], usage: Map<string, number>): number {
  return ingredients.reduce((sum, ingredient) => {
    const stock = Math.max(0, stockLevel(ingredient.id, movements, usage))
    return sum + stock * ingredient.costPerUnit
  }, 0)
}

export function topSellingMenus(transactions: Transaction[], limit = 5): { id: string; name: string; qty: number; revenue: number }[] {
  const totals = new Map<string, { name: string; qty: number; revenue: number }>()
  for (const transaction of transactions.filter(completed)) {
    for (const item of transaction.items) {
      const current = totals.get(item.id) ?? { name: item.name, qty: 0, revenue: 0 }
      current.qty += item.qty
      current.revenue += item.price * item.qty
      totals.set(item.id, current)
    }
  }
  return [...totals.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.qty - a.qty).slice(0, limit)
}

export function cogsForTransactions(transactions: Transaction[], menus: Menu[], ingredients: Ingredient[]): number {
  let total = 0
  for (const transaction of transactions.filter(completed)) {
    for (const item of transaction.items) {
      const menu = menus.find((entry) => entry.id === item.id)
      if (!menu) continue
      const cost = menu.recipe.reduce((sum, line) => {
        const ingredient = ingredients.find((entry) => entry.id === line.ingredientId)
        return sum + (ingredient ? ingredient.costPerUnit * line.qty : 0)
      }, 0)
      total += cost * item.qty
    }
  }
  return total
}
