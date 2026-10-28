import type { CartItem, CashMovement, HeldOrder, PosStore, PreOrder, Shift, Transaction } from '../../domain/pos'
import type { Expense } from '../../domain/accounting'
import type { Ingredient, IngredientCategory, Menu, MenuCategory, RecipeLine } from '../../domain/catalog'
import type { StockMovement } from '../../domain/inventory'
import type { AppSettings } from '../../domain/settings'
import type { Row, TableName } from './gateway'

/* -------------------------------------------------------------------------- */
/* Helper nilai                                                              */
/* -------------------------------------------------------------------------- */

export const text = (value: unknown, fallback = ''): string => (typeof value === 'string' && value.trim() ? value : fallback)

/** PostgREST mengirim numeric sebagai string; selalu lewat Number(). */
export const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export const optionalNum = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = num(value, Number.NaN)
  return Number.isFinite(parsed) ? parsed : undefined
}

const bool = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback)

export const iso = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback
  return Number.isNaN(new Date(value).getTime()) ? fallback : value
}

export const optionalIso = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value) return undefined
  return Number.isNaN(new Date(value).getTime()) ? undefined : value
}

export const DOCUMENT_KEYS = ['held_orders', 'pre_orders', 'cash_movements', 'expenses', 'audit_log'] as const
export type DocumentKey = typeof DOCUMENT_KEYS[number]

export type DocumentMap = Record<DocumentKey, unknown[]>

/* -------------------------------------------------------------------------- */
/* Domain -> row                                                             */
/* -------------------------------------------------------------------------- */

export function menuRow(menu: Menu, outletId: string): Row {
  return {
    id: menu.id,
    outlet_id: outletId,
    name: menu.name,
    category: menu.category,
    price: menu.price,
    emoji: menu.emoji,
    image_url: menu.imageUrl ?? null,
    active: menu.active,
    recipe: menu.recipe satisfies RecipeLine[],
  }
}

export function menuFromRow(row: Row): Menu {
  const imageUrl = typeof row.image_url === 'string' && row.image_url.trim() ? row.image_url : undefined
  const recipe = Array.isArray(row.recipe)
    ? row.recipe.flatMap((line): RecipeLine[] => {
        if (!line || typeof line !== 'object') return []
        const entry = line as Record<string, unknown>
        const ingredientId = text(entry.ingredientId)
        const qty = num(entry.qty, 0)
        return ingredientId && qty > 0 ? [{ ingredientId, qty }] : []
      })
    : []
  return {
    id: text(row.id),
    name: text(row.name, 'Menu'),
    category: text(row.category, 'Lainnya'),
    price: num(row.price, 0),
    emoji: text(row.emoji, '🍽️'),
    ...(imageUrl ? { imageUrl } : {}),
    active: bool(row.active, true),
    recipe,
  }
}

export function ingredientRow(ingredient: Ingredient, outletId: string): Row {
  return {
    id: ingredient.id,
    outlet_id: outletId,
    name: ingredient.name,
    category: ingredient.category,
    unit: ingredient.unit,
    cost_per_unit: ingredient.costPerUnit,
    purchase_unit: ingredient.purchaseUnit,
    purchase_price: ingredient.purchasePrice,
    usage_per_purchase_unit: ingredient.usagePerPurchaseUnit,
    min_stock: ingredient.minStock,
  }
}

export function ingredientFromRow(row: Row): Ingredient {
  return {
    id: text(row.id),
    name: text(row.name, 'Bahan'),
    category: text(row.category, 'Lainnya'),
    unit: text(row.unit, 'unit'),
    costPerUnit: num(row.cost_per_unit, 0),
    purchaseUnit: text(row.purchase_unit, 'unit'),
    purchasePrice: num(row.purchase_price, 0),
    usagePerPurchaseUnit: num(row.usage_per_purchase_unit, 1) || 1,
    minStock: num(row.min_stock, 0),
  }
}

export function categoryRow(category: MenuCategory | IngredientCategory, outletId: string): Row {
  return { id: category.id, outlet_id: outletId, name: category.name }
}

export function categoryFromRow(row: Row): MenuCategory {
  return { id: text(row.id), name: text(row.name, 'Kategori') }
}

export function stockMovementRow(movement: StockMovement, outletId: string): Row {
  return {
    id: movement.id,
    outlet_id: outletId,
    ingredient_id: movement.ingredientId,
    type: movement.type,
    qty: movement.qty,
    total_cost: movement.totalCost,
    note: movement.note,
    unit_cost: movement.unitCost ?? null,
    counted_qty: movement.countedQty ?? null,
    system_qty: movement.systemQty ?? null,
    created_at: movement.createdAt,
  }
}

export function stockMovementFromRow(row: Row): StockMovement {
  const type = text(row.type, 'adjustment')
  const base: StockMovement = {
    id: text(row.id),
    createdAt: iso(row.created_at, '1970-01-01T00:00:00.000Z'),
    ingredientId: text(row.ingredient_id),
    type: type === 'purchase' || type === 'opname' ? type : 'adjustment',
    qty: num(row.qty, 0),
    totalCost: num(row.total_cost, 0),
    note: text(row.note, 'Tanpa catatan'),
  }
  if (base.type === 'opname') {
    const unitCost = optionalNum(row.unit_cost)
    const countedQty = optionalNum(row.counted_qty)
    const systemQty = optionalNum(row.system_qty)
    if (unitCost !== undefined) base.unitCost = unitCost
    if (countedQty !== undefined) base.countedQty = countedQty
    if (systemQty !== undefined) base.systemQty = systemQty
  }
  return base
}

export function shiftRow(shift: Shift, outletId: string): Row {
  return {
    id: shift.id,
    outlet_id: outletId,
    opened_at: shift.openedAt,
    closed_at: shift.closedAt ?? null,
    opening_float: shift.openingFloat,
    actual_cash: shift.actualCash ?? null,
    status: shift.status,
  }
}

export function shiftFromRow(row: Row): Shift {
  const actualCash = optionalNum(row.actual_cash)
  return {
    id: text(row.id),
    openedAt: iso(row.opened_at, '1970-01-01T00:00:00.000Z'),
    ...(optionalIso(row.closed_at) ? { closedAt: optionalIso(row.closed_at) } : {}),
    openingFloat: num(row.opening_float, 0),
    ...(actualCash !== undefined ? { actualCash } : {}),
    status: text(row.status) === 'closed' ? 'closed' : 'open',
  }
}

export function transactionRow(transaction: Transaction, outletId: string): Row {
  return {
    id: transaction.id,
    outlet_id: outletId,
    shift_id: transaction.shiftId || null,
    number: transaction.number,
    created_at: transaction.createdAt,
    order_type: transaction.orderType,
    payment_method: transaction.paymentMethod,
    items: transaction.items satisfies CartItem[],
    subtotal: transaction.subtotal,
    paid_amount: transaction.paidAmount,
    change_due: transaction.change,
    status: transaction.status,
    note: transaction.note ?? null,
    status_reason: transaction.statusReason ?? null,
    status_changed_at: transaction.statusChangedAt ?? null,
  }
}

export function transactionFromRow(row: Row): Transaction {
  const items = Array.isArray(row.items)
    ? row.items.flatMap((item): CartItem[] => {
        if (!item || typeof item !== 'object') return []
        const entry = item as Record<string, unknown>
        const id = text(entry.id)
        const qty = num(entry.qty, 0)
        if (!id || qty <= 0) return []
        const imageUrl = typeof entry.imageUrl === 'string' && entry.imageUrl.trim() ? entry.imageUrl : undefined
        const emoji = typeof entry.emoji === 'string' && entry.emoji.trim() ? entry.emoji : undefined
        return [{
          id,
          name: text(entry.name, 'Menu'),
          category: text(entry.category, 'Lainnya'),
          price: num(entry.price, 0),
          qty,
          ...(emoji ? { emoji } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        }]
      })
    : []
  const orderType = text(row.order_type, 'Takeaway')
  return {
    id: text(row.id),
    number: text(row.number, 'POS-0'),
    createdAt: iso(row.created_at, '1970-01-01T00:00:00.000Z'),
    orderType: (['Takeaway', 'Dine in', 'GoFood', 'GrabFood', 'ShopeeFood'] as const).includes(orderType as Transaction['orderType']) ? orderType as Transaction['orderType'] : 'Takeaway',
    paymentMethod: (['Cash', 'QRIS', 'Unpaid'] as const).includes(text(row.payment_method) as Transaction['paymentMethod']) ? text(row.payment_method) as Transaction['paymentMethod'] : 'Cash',
    items,
    subtotal: num(row.subtotal, 0),
    paidAmount: num(row.paid_amount, 0),
    change: num(row.change_due, 0),
    status: (['completed', 'cancelled', 'refunded'] as const).includes(text(row.status) as Transaction['status']) ? text(row.status) as Transaction['status'] : 'completed',
    ...(typeof row.note === 'string' && row.note ? { note: row.note } : {}),
    ...(typeof row.status_reason === 'string' && row.status_reason ? { statusReason: row.status_reason } : {}),
    ...(optionalIso(row.status_changed_at) ? { statusChangedAt: optionalIso(row.status_changed_at) } : {}),
    shiftId: text(row.shift_id),
  }
}

/** Nomor transaksi berikutnya tidak disimpan: diturunkan dari nomor terakhir di tabel transaksi. */
export function settingsRow(settings: AppSettings, outletId: string): Row {
  return { outlet_id: outletId, data: settings satisfies AppSettings }
}

/* -------------------------------------------------------------------------- */
/* Dokumen pendukung                                                         */
/* -------------------------------------------------------------------------- */

export function documentsFromStore(store: PosStore): DocumentMap {
  return {
    held_orders: store.heldOrders satisfies HeldOrder[],
    pre_orders: store.preOrders satisfies PreOrder[],
    cash_movements: store.cashMovements satisfies CashMovement[],
    expenses: store.expenses satisfies Expense[],
    audit_log: store.auditLog,
  }
}

export function documentsFromRows(rows: Row[]): Partial<DocumentMap> {
  const documents: Partial<DocumentMap> = {}
  for (const row of rows) {
    const key = text(row.key) as DocumentKey
    if (!DOCUMENT_KEYS.includes(key)) continue
    documents[key] = Array.isArray(row.data) ? row.data : []
  }
  return documents
}

export function documentRow(key: DocumentKey, data: unknown[], outletId: string): Row {
  return { outlet_id: outletId, key, data }
}

/** Signature baris untuk deteksi perubahan; timestamp tidak dihitung. */
export function rowSignature(table: TableName, row: Row): string {
  const copy: Row = { ...row }
  delete copy.updated_at
  if (table === 'menu_items' || table === 'ingredients' || table === 'stock_movements' || table === 'transactions') {
    // created_at ikut data (waktu bisnis), jangan dihapus dari signature.
  } else {
    delete copy.created_at
  }
  return JSON.stringify(copy)
}
