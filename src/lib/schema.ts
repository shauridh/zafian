import { seedCategories, seedIngredientCategories, seedIngredients, seedMenus, type Category, type Ingredient, type IngredientCategory, type Menu, type MenuCategory, type RecipeLine } from '../domain/catalog'
import type { ExpenseCategory } from '../domain/accounting'
import {
  SCHEMA_VERSION,
  type AuditEntry,
  type CashMovement,
  type CartItem,
  type HeldOrder,
  type OrderType,
  type PaymentMethod,
  type PosStore,
  type PreOrder,
  type PreOrderStatus,
  type Shift,
  type Transaction,
  type TransactionStatus,
} from '../domain/pos'
import type { StockMovement } from '../domain/inventory'
import { defaultSettings, type AppSettings, type OwnerPinRecord, type ThemeMode } from '../domain/settings'

const ORDER_TYPES: OrderType[] = ['Takeaway', 'Dine in', 'GoFood', 'GrabFood', 'ShopeeFood']
const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'QRIS', 'Unpaid']
const TRANSACTION_STATUSES: TransactionStatus[] = ['completed', 'cancelled', 'refunded']
const PREORDER_STATUSES: PreOrderStatus[] = ['draft', 'dp_received', 'processing', 'completed', 'cancelled']
const EXPENSE_CATEGORIES: ExpenseCategory[] = ['Bahan', 'Gaji', 'Sewa', 'Listrik & air', 'Internet', 'Transportasi', 'Perawatan', 'Platform', 'Lain-lain']
const FALLBACK_DATE = '1970-01-01T00:00:00.000Z'
const DEFAULT_FLOAT = 350000
const AUDIT_ACTIONS = [
  'sale', 'void', 'refund', 'shift_open', 'shift_close', 'cash_in', 'cash_out', 'purchase', 'adjustment', 'opname',
  'expense', 'menu_update', 'menu_create', 'menu_delete', 'ingredient_update', 'ingredient_create',
  'ingredient_delete', 'category_update', 'settings_update', 'preorder', 'restore',
] as const

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim() ? value : fallback
const num = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const nonNegative = (value: unknown, fallback: number): number => Math.max(0, num(value, fallback))
const date = (value: unknown): string => typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) ? value : FALLBACK_DATE
const oneOf = <T extends string>(value: unknown, allowed: T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback

function cloneSeeds<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeRecipe(value: unknown): RecipeLine[] {
  return asArray(value).flatMap((line) => {
    if (!isObject(line)) return []
    const ingredientId = text(line.ingredientId, '')
    const qty = num(line.qty, 0)
    return ingredientId && qty > 0 ? [{ ingredientId, qty }] : []
  })
}

function normalizeMenu(value: unknown, index: number): Menu | null {
  if (!isObject(value)) return null
  const id = text(value.id, '')
  if (!id) return null
  const imageUrl = typeof value.imageUrl === 'string' && value.imageUrl.trim() ? value.imageUrl.trim() : undefined
  return {
    id,
    name: text(value.name, `Menu ${index + 1}`),
    category: text(value.category, 'Lainnya'),
    price: nonNegative(value.price, 0),
    emoji: text(value.emoji, '🍽️'),
    ...(imageUrl ? { imageUrl } : {}),
    active: value.active !== false,
    recipe: normalizeRecipe(value.recipe),
  }
}

const slugify = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function normalizeCategory(value: unknown, index: number): MenuCategory | null {
  if (!isObject(value)) return null
  const name = text(value.name, '')
  if (!name) return null
  return { id: text(value.id, slugify(name) || `kategori-${index + 1}`), name }
}

/**
 * ID UUID deterministik untuk kategori turunan pada mode online. Tabel
 * Supabase memakai kolom uuid, sedangkan kategori lokal memakai slug; tanpa
 * konversi ini, kategori default seperti "Lainnya" dikirim sebagai string dan
 * ditolak Postgres (22P02: invalid input syntax for type uuid).
 */
function stableCategoryUuid(name: string): string {
  const key = name.trim().toLowerCase()
  const hash = (seed: number): string => {
    let value = seed >>> 0
    for (let index = 0; index < key.length; index += 1) {
      value ^= key.charCodeAt(index)
      value = Math.imul(value, 0x01000193) >>> 0
    }
    return value.toString(16).padStart(8, '0')
  }
  const hex = `${hash(0x811c9dc5)}${hash(0x9e3779b9)}${hash(0x85ebca6b)}${hash(0xc2b2ae35)}`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Tambahkan kategori yang dipakai menu tetapi belum ada di daftar kategori. */
function mergeCategories<T extends Category>(
  base: T[],
  usedNames: string[],
  createId: (name: string, index: number) => string = (name, index) => slugify(name) || `kategori-${index + 1}`,
): T[] {
  const categories = base.filter((category, index) => base.findIndex((item) => item.name.toLowerCase() === category.name.toLowerCase()) === index)
  const names = new Set(categories.map((category) => category.name.trim().toLowerCase()))
  const ids = new Set(categories.map((category) => category.id))
  for (const rawName of usedNames) {
    const name = rawName.trim()
    const key = name.toLowerCase()
    if (!key || names.has(key)) continue
    let id = createId(name, categories.length)
    while (ids.has(id)) id = `${id}-${categories.length + 1}`
    names.add(key)
    ids.add(id)
    categories.push({ id, name } as T)
  }
  return categories
}

function normalizeOwnerPin(value: unknown): OwnerPinRecord | undefined {
  if (!isObject(value)) return undefined
  const salt = typeof value.salt === 'string' ? value.salt : ''
  const hash = typeof value.hash === 'string' ? value.hash : ''
  const recoverySalt = typeof value.recoverySalt === 'string' ? value.recoverySalt : ''
  const recoveryHash = typeof value.recoveryHash === 'string' ? value.recoveryHash : ''
  const updatedAt = typeof value.updatedAt === 'string' && !Number.isNaN(new Date(value.updatedAt).getTime()) ? value.updatedAt : ''
  if (!/^[a-f0-9]{16,128}$/i.test(salt) || !/^[a-f0-9]{64}$/i.test(hash)) return undefined
  if (!/^[a-f0-9]{16,128}$/i.test(recoverySalt) || !/^[a-f0-9]{64}$/i.test(recoveryHash) || !updatedAt) return undefined
  return { salt, hash, recoverySalt, recoveryHash, updatedAt }
}

/** Pemakaian standar bahan: hanya entri dengan jumlah positif yang disimpan. */
function normalizeIngredientUsage(value: unknown): Record<string, number> {
  if (!isObject(value)) return {}
  const entries: [string, number][] = []
  for (const [key, raw] of Object.entries(value)) {
    const id = key.trim()
    const qty = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
    if (!id || !Number.isFinite(qty) || qty <= 0) continue
    entries.push([id, qty])
  }
  return Object.fromEntries(entries)
}

function normalizeSettings(value: unknown): AppSettings {
  const raw = isObject(value) ? value : {}
  const printer = isObject(raw.printer) ? raw.printer : {}
  const ownerPin = normalizeOwnerPin(raw.ownerPin)
  return {
    businessName: text(raw.businessName, defaultSettings.businessName),
    outletName: text(raw.outletName, defaultSettings.outletName),
    outletPhone: text(raw.outletPhone, ''),
    receiptFooter: text(raw.receiptFooter, defaultSettings.receiptFooter),
    receiptPromo: text(raw.receiptPromo, ''),
    ingredientUsage: normalizeIngredientUsage(raw.ingredientUsage),
    theme: oneOf<ThemeMode>(raw.theme, ['light', 'dark'], defaultSettings.theme),
    ...(ownerPin ? { ownerPin } : {}),
    printer: {
      deviceName: typeof printer.deviceName === 'string' ? printer.deviceName : defaultSettings.printer.deviceName,
      paperWidth: num(printer.paperWidth, 58) === 80 ? 80 : 58,
      autoPrint: printer.autoPrint === true,
      headerAlign: oneOf(printer.headerAlign, ['left', 'center'] as const, defaultSettings.printer.headerAlign),
      footerAlign: oneOf(printer.footerAlign, ['left', 'center'] as const, defaultSettings.printer.footerAlign),
      fontSize: oneOf(printer.fontSize, ['compact', 'normal', 'large'] as const, defaultSettings.printer.fontSize),
      showOrderType: printer.showOrderType !== false,
      showPaymentDetail: printer.showPaymentDetail !== false,
      copies: Math.min(3, Math.max(1, Math.floor(num(printer.copies, defaultSettings.printer.copies)))),
    },
  }
}

function normalizeIngredient(value: unknown, index: number): Ingredient | null {
  if (!isObject(value)) return null
  const id = text(value.id, '')
  if (!id) return null
  const purchasePrice = nonNegative(value.purchasePrice, 0)
  const usagePerPurchaseUnit = num(value.usagePerPurchaseUnit, 0)
  return {
    id,
    name: text(value.name, `Bahan ${index + 1}`),
    category: text(value.category, 'Lainnya'),
    unit: text(value.unit, 'unit'),
    costPerUnit: nonNegative(value.costPerUnit, 0),
    purchaseUnit: text(value.purchaseUnit, 'unit'),
    purchasePrice,
    usagePerPurchaseUnit: usagePerPurchaseUnit > 0 ? usagePerPurchaseUnit : 1,
    minStock: nonNegative(value.minStock, 0),
  }
}

function normalizeItems(value: unknown): CartItem[] {
  return asArray(value).flatMap((item) => {
    if (!isObject(item)) return []
    const id = text(item.id, '')
    const qty = num(item.qty, 0)
    if (!id || qty <= 0) return []
    const imageUrl = typeof item.imageUrl === 'string' && item.imageUrl.trim() ? item.imageUrl.trim() : undefined
    const emoji = typeof item.emoji === 'string' && item.emoji.trim() ? item.emoji : undefined
    return [{
      id,
      name: text(item.name, 'Menu'),
      category: text(item.category, 'Lainnya'),
      price: nonNegative(item.price, 0),
      qty,
      ...(emoji ? { emoji } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    }]
  })
}

const itemsTotal = (items: CartItem[]) => items.reduce((sum, item) => sum + item.price * item.qty, 0)

function normalizeTransaction(value: unknown, index: number): Transaction | null {
  if (!isObject(value)) return null
  const items = normalizeItems(value.items)
  const subtotal = nonNegative(value.subtotal, itemsTotal(items))
  // Versi lama belum menyimpan paidAmount/change; turunkan dari subtotal agar kas tidak NaN.
  const paidAmount = nonNegative(value.paidAmount, subtotal)
  const change = nonNegative(value.change, Math.max(0, paidAmount - subtotal))
  return {
    id: text(value.id, `legacy-transaction-${index + 1}`),
    number: text(value.number, `POS-LEGACY-${index + 1}`),
    createdAt: date(value.createdAt),
    orderType: oneOf(value.orderType, ORDER_TYPES, 'Takeaway'),
    paymentMethod: oneOf(value.paymentMethod, PAYMENT_METHODS, 'Cash'),
    items,
    subtotal,
    paidAmount,
    change,
    status: oneOf(value.status, TRANSACTION_STATUSES, 'completed'),
    note: typeof value.note === 'string' ? value.note : undefined,
    statusReason: typeof value.statusReason === 'string' ? value.statusReason : undefined,
    statusChangedAt: typeof value.statusChangedAt === 'string' ? value.statusChangedAt : undefined,
    shiftId: text(value.shiftId, ''),
  }
}

function normalizeCashMovement(value: unknown, index: number): CashMovement | null {
  if (!isObject(value)) return null
  const amount = num(value.amount, 0)
  if (amount <= 0) return null
  return {
    id: text(value.id, `legacy-cash-movement-${index + 1}`),
    createdAt: date(value.createdAt),
    type: oneOf(value.type, ['in', 'out'] as const, 'in'),
    amount,
    note: text(value.note, 'Tanpa catatan'),
    shiftId: text(value.shiftId, ''),
  }
}

function normalizeShift(value: unknown, index: number): Shift | null {
  if (!isObject(value)) return null
  const status = oneOf(value.status, ['open', 'closed'] as const, 'open')
  return {
    id: text(value.id, `legacy-shift-${index + 1}`),
    openedAt: date(value.openedAt),
    closedAt: typeof value.closedAt === 'string' ? value.closedAt : undefined,
    openingFloat: nonNegative(value.openingFloat, DEFAULT_FLOAT),
    actualCash: typeof value.actualCash === 'number' && Number.isFinite(value.actualCash) ? value.actualCash : undefined,
    status,
  }
}

function normalizeHeld(value: unknown, index: number): HeldOrder | null {
  if (!isObject(value)) return null
  const items = normalizeItems(value.items)
  if (items.length === 0) return null
  return {
    id: text(value.id, `legacy-held-${index + 1}`),
    createdAt: date(value.createdAt),
    items,
    orderType: oneOf(value.orderType, ORDER_TYPES, 'Takeaway'),
  }
}

function normalizePreOrder(value: unknown, index: number): PreOrder | null {
  if (!isObject(value)) return null
  const items = normalizeItems(value.items)
  const total = nonNegative(value.total, itemsTotal(items))
  const dp = Math.min(nonNegative(value.dp, 0), total)
  const status = oneOf(value.status, PREORDER_STATUSES, dp > 0 ? 'dp_received' : 'draft')
  return {
    id: text(value.id, `legacy-preorder-${index + 1}`),
    createdAt: date(value.createdAt),
    customerName: text(value.customerName, 'Pelanggan'),
    pickupAt: date(value.pickupAt),
    items,
    orderType: oneOf(value.orderType, ORDER_TYPES, 'Takeaway'),
    total,
    dp,
    paymentMethod: oneOf(value.paymentMethod, PAYMENT_METHODS, 'Cash'),
    status,
    note: typeof value.note === 'string' ? value.note : undefined,
    transactionId: typeof value.transactionId === 'string' ? value.transactionId : undefined,
  }
}

function normalizeStockMovement(value: unknown, index: number, costOf: (ingredientId: string) => number): StockMovement | null {
  if (!isObject(value)) return null
  const type = oneOf(value.type, ['purchase', 'adjustment', 'opname'] as const, 'adjustment')
  const qty = num(value.qty, 0)
  if (!Number.isFinite(qty) || (type !== 'opname' && qty === 0)) return null
  const ingredientId = text(value.ingredientId, '')
  let countedQty: number | undefined
  let systemQty: number | undefined
  let unitCost: number | undefined
  if (type === 'opname') {
    const rawCounted = typeof value.countedQty === 'number' && Number.isFinite(value.countedQty) ? value.countedQty : undefined
    const rawSystem = typeof value.systemQty === 'number' && Number.isFinite(value.systemQty) ? value.systemQty : undefined
    countedQty = rawCounted ?? (rawSystem !== undefined ? rawSystem + qty : Math.max(0, qty))
    systemQty = rawSystem ?? countedQty - qty
    // Opname lama belum punya biaya snapshot; ambil biaya bahan saat migrasi lalu bekukan.
    unitCost = nonNegative(value.unitCost, costOf(ingredientId))
  }
  return {
    id: text(value.id, `legacy-stock-movement-${index + 1}`),
    createdAt: date(value.createdAt),
    ingredientId,
    type,
    qty,
    totalCost: nonNegative(value.totalCost, 0),
    note: text(value.note, 'Tanpa catatan'),
    ...(type === 'opname' ? { unitCost, countedQty, systemQty } : {}),
  }
}

function normalizeAudit(value: unknown, index: number): AuditEntry | null {
  if (!isObject(value)) return null
  return {
    id: text(value.id, `legacy-audit-${index + 1}`),
    createdAt: date(value.createdAt),
    action: oneOf(value.action, [...AUDIT_ACTIONS], 'menu_update'),
    detail: text(value.detail, ''),
  }
}

function nextNumber(transactions: Transaction[], provided: unknown): number {
  const highest = transactions.reduce((max, item) => {
    const match = /(\d+)\s*$/.exec(item.number)
    const parsed = match ? Number(match[1]) : 0
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max
  }, 0)
  const fallback = Math.max(274, highest + 1)
  const value = num(provided, fallback)
  return Math.max(274, Math.floor(value), highest + 1)
}

/**
 * Normalisasi idempoten untuk state lokal maupun backup.
 * Aturan penting:
 * - tidak membuat transaksi/jurnal baru, hanya merapikan bentuk data;
 * - seed katalog hanya dipakai bila daftar benar-benar kosong;
 * - data pengguna (harga, resep, riwayat) tidak ditimpa.
 */
export type NormalizeOptions = {
  /** false = jangan isi katalog contoh saat daftar kosong (dipakai data online). */
  seed?: boolean
}

export function normalizeStore(input: unknown, options: NormalizeOptions = {}): PosStore {
  const seed = options.seed !== false
  const raw = isObject(input) ? input : {}
  const menus = asArray(raw.menus).map(normalizeMenu).filter((item): item is Menu => item !== null)
  const ingredients = asArray(raw.ingredients).map(normalizeIngredient).filter((item): item is Ingredient => item !== null)
  const transactions = asArray(raw.transactions).map(normalizeTransaction).filter((item): item is Transaction => item !== null)
  const cashMovements = asArray(raw.cashMovements).map(normalizeCashMovement).filter((item): item is CashMovement => item !== null)
  const shifts = asArray(raw.shifts).map(normalizeShift).filter((item): item is Shift => item !== null)
  const heldOrders = asArray(raw.heldOrders).map(normalizeHeld).filter((item): item is HeldOrder => item !== null)
  const preOrders = asArray(raw.preOrders).map(normalizePreOrder).filter((item): item is PreOrder => item !== null)
  const costByIngredient = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.costPerUnit]))
  const stockMovements = asArray(raw.stockMovements)
    .map((item, index) => normalizeStockMovement(item, index, (ingredientId) => costByIngredient.get(ingredientId) ?? 0))
    .filter((item): item is StockMovement => item !== null)
  const storedCategories = asArray(raw.categories).map(normalizeCategory).filter((item): item is MenuCategory => item !== null)
  const storedIngredientCategories = asArray(raw.ingredientCategories).map(normalizeCategory).filter((item): item is IngredientCategory => item !== null)
  const expenses = asArray(raw.expenses).flatMap((expense, index) => {
    if (!isObject(expense)) return []
    const amount = num(expense.amount, 0)
    if (amount <= 0) return []
    return [{
      id: text(expense.id, `legacy-expense-${index + 1}`),
      createdAt: date(expense.createdAt),
      category: oneOf(expense.category, EXPENSE_CATEGORIES, 'Lain-lain'),
      amount,
      note: text(expense.note, 'Beban'),
    }]
  })
  const auditLog = asArray(raw.auditLog).map(normalizeAudit).filter((item): item is AuditEntry => item !== null)
  const finalMenus = menus.length > 0 ? menus : seed ? cloneSeeds(seedMenus) : []
  const finalIngredients = ingredients.length > 0 ? ingredients : seed ? cloneSeeds(seedIngredients) : []
  // Mode online (seed:false) memakai UUID agar kategori turunan bisa disimpan
  // ke Supabase; mode lokal tetap memakai slug agar data lama tidak berubah.
  const inferredCategoryId = seed ? undefined : stableCategoryUuid
  const finalCategories = mergeCategories(
    storedCategories.length > 0 ? storedCategories : seed ? cloneSeeds(seedCategories) : [],
    finalMenus.map((menu) => menu.category),
    inferredCategoryId,
  )
  const finalIngredientCategories = mergeCategories(
    storedIngredientCategories.length > 0 ? storedIngredientCategories : seed ? cloneSeeds(seedIngredientCategories) : [],
    finalIngredients.map((ingredient) => ingredient.category),
    inferredCategoryId,
  )

  return {
    schemaVersion: SCHEMA_VERSION,
    transactions,
    cashMovements,
    shifts,
    heldOrders,
    preOrders,
    menus: finalMenus,
    categories: finalCategories,
    ingredients: finalIngredients,
    ingredientCategories: finalIngredientCategories,
    stockMovements,
    expenses,
    auditLog,
    settings: normalizeSettings(raw.settings),
    nextTransactionNumber: nextNumber(transactions, raw.nextTransactionNumber),
  }
}
