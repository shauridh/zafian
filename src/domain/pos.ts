import type { Expense } from './accounting'
import type { Ingredient, IngredientCategory, Menu, MenuCategory } from './catalog'
import { seedCategories, seedIngredientCategories, seedIngredients, seedMenus } from './catalog'
import { createDefaultSettings, type AppSettings } from './settings'
import type { StockMovement } from './inventory'

export type OrderType = 'Takeaway' | 'Dine in' | 'GoFood' | 'GrabFood' | 'ShopeeFood'
export type PaymentMethod = 'Cash' | 'QRIS' | 'Unpaid'
export type TransactionStatus = 'completed' | 'cancelled' | 'refunded'
export type PreOrderStatus = 'draft' | 'dp_received' | 'processing' | 'completed' | 'cancelled'
export type CashMovementType = 'in' | 'out'

export type Money = number

export type CartItem = {
  id: string
  name: string
  category: string
  price: Money
  qty: number
  emoji?: string
  imageUrl?: string
}

export type Transaction = {
  id: string
  number: string
  createdAt: string
  orderType: OrderType
  paymentMethod: PaymentMethod
  items: CartItem[]
  subtotal: Money
  paidAmount: Money
  change: Money
  status: TransactionStatus
  note?: string
  statusReason?: string
  statusChangedAt?: string
  shiftId: string
}

export type CashMovement = {
  id: string
  createdAt: string
  type: CashMovementType
  amount: Money
  note: string
  shiftId: string
}

export type Shift = {
  id: string
  openedAt: string
  closedAt?: string
  openingFloat: Money
  actualCash?: Money
  status: 'open' | 'closed'
}

export type HeldOrder = {
  id: string
  createdAt: string
  items: CartItem[]
  orderType: OrderType
}

export type PreOrder = {
  id: string
  createdAt: string
  customerName: string
  pickupAt: string
  items: CartItem[]
  orderType: OrderType
  total: Money
  dp: Money
  paymentMethod: PaymentMethod
  status: PreOrderStatus
  note?: string
  transactionId?: string
}

export type AuditAction = 'sale' | 'void' | 'refund' | 'shift_open' | 'shift_close' | 'cash_in' | 'cash_out' | 'purchase' | 'adjustment' | 'opname' | 'expense' | 'menu_update' | 'menu_create' | 'menu_delete' | 'ingredient_update' | 'ingredient_create' | 'ingredient_delete' | 'category_update' | 'settings_update' | 'preorder' | 'restore'

export type AuditEntry = {
  id: string
  createdAt: string
  action: AuditAction
  detail: string
}

export const SCHEMA_VERSION = 8

export type PosStore = {
  schemaVersion: number
  transactions: Transaction[]
  cashMovements: CashMovement[]
  shifts: Shift[]
  heldOrders: HeldOrder[]
  preOrders: PreOrder[]
  menus: Menu[]
  categories: MenuCategory[]
  ingredients: Ingredient[]
  ingredientCategories: IngredientCategory[]
  stockMovements: StockMovement[]
  expenses: Expense[]
  auditLog: AuditEntry[]
  settings: AppSettings
  nextTransactionNumber: number
}

export const initialPosStore: PosStore = {
  schemaVersion: SCHEMA_VERSION,
  transactions: [],
  cashMovements: [],
  shifts: [],
  heldOrders: [],
  preOrders: [],
  menus: seedMenus,
  categories: seedCategories,
  ingredients: seedIngredients,
  ingredientCategories: seedIngredientCategories,
  stockMovements: [],
  expenses: [],
  auditLog: [],
  settings: createDefaultSettings(),
  nextTransactionNumber: 274,
}

export function cashSalesForShift(store: PosStore, shiftId: string): Money {
  return store.transactions
    .filter((item) => item.shiftId === shiftId && item.status === 'completed' && item.paymentMethod === 'Cash')
    .reduce((sum, item) => sum + Math.max(0, item.paidAmount - item.change), 0)
}

export function cashMovementsForShift(store: PosStore, shiftId: string, type: CashMovementType): Money {
  return store.cashMovements.filter((item) => item.shiftId === shiftId && item.type === type).reduce((sum, item) => sum + item.amount, 0)
}

export function expectedCashForShift(store: PosStore, shift: Shift): Money {
  return shift.openingFloat + cashSalesForShift(store, shift.id) + cashMovementsForShift(store, shift.id, 'in') - cashMovementsForShift(store, shift.id, 'out')
}

export function preOrderCanStartProcessing(status: PreOrderStatus): boolean {
  return status === 'dp_received' || status === 'draft'
}

export function preOrderRemaining(total: Money, dp: Money): Money {
  return Math.max(0, total - dp)
}
