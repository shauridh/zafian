/**
 * Fase 0 exporter: backup lokal → staging siap-impor Supabase.
 *
 * Fungsi ini murni (tidak menulis file, tidak menyentuh jaringan, tidak
 * mengubah store). Semua kolom mengikuti DDL di
 * docs/superpowers/specs/2026-10-26-supabase-sync-design.md, sehingga hasilnya
 * bisa diperiksa sebagai JSONL sebelum Fase 1 membuat project Supabase.
 */
import { buildJournals, chartOfAccounts, trialBalance } from '../domain/accounting'
import { cogsForTransactions } from '../domain/inventory'
import type { PosStore } from '../domain/pos'
import { LOCAL_DEVICE_ID, LOCAL_OUTLET_ID } from '../domain/sync'

export const STAGING_FORMAT = 'sabana-pos-supabase-staging'
export const STAGING_FORMAT_VERSION = 1
export const LEGACY_SHIFT_ID = 'shift-legacy-local'

export const STAGING_TABLES = [
  'outlets',
  'outlet_settings',
  'outlet_counters',
  'categories',
  'menus',
  'ingredients',
  'menu_recipes',
  'shifts',
  'transactions',
  'transaction_items',
  'cash_movements',
  'stock_movements',
  'expenses',
  'preorders',
  'preorder_items',
  'accounts',
  'journal_entries',
  'journal_lines',
  'audit_log',
] as const

export type StagingTableName = typeof STAGING_TABLES[number]
export type StagingRow = Record<string, unknown>

export type ExportIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  entityId?: string
}

export type ShiftControl = {
  shiftId: string
  status: string
  openingFloat: number
  cashSales: number
  cashIn: number
  cashOut: number
  expectedCash: number
  actualCash: number | null
  variance: number | null
}

export type StagingControl = {
  transactions: { total: number; completed: number; cancelled: number; refunded: number }
  money: { revenue: number; paid: number; change: number; cashSales: number; qrisSales: number; unpaidSales: number }
  shifts: ShiftControl[]
  journals: { entries: number; lines: number; debit: number; credit: number; balanced: boolean }
  inventory: { purchaseValue: number; opnameAdjustment: number }
}

export type StagingManifest = {
  format: typeof STAGING_FORMAT
  formatVersion: number
  generatedAt: string
  outletId: string
  deviceId: string
  appSchemaVersion: number
  counts: Record<StagingTableName, number>
  sourceCounts: {
    transactions: number
    cashMovements: number
    shifts: number
    preOrders: number
    menus: number
    categories: number
    ingredients: number
    stockMovements: number
    expenses: number
    auditLog: number
    heldOrders: number
  }
  excluded: { heldOrders: number }
  /** Daftar ID stabil untuk audit Fase 0 (termasuk shift legacy bila dibuat). */
  ids: {
    categories: string[]
    menus: string[]
    ingredients: string[]
    transactions: string[]
    shifts: string[]
  }
  /** Nilai yang diturunkan karena model lokal tidak menyimpannya. */
  derived: { catalogTimestamp: string; legacyShiftId: string | null }
  control: StagingControl
  issues: ExportIssue[]
}

export type StagingExport = {
  tables: Record<StagingTableName, StagingRow[]>
  manifest: StagingManifest
}

export type StagingOptions = {
  outletId?: string
  deviceId?: string
}

const round2 = (value: number): number => Math.round(value * 100) / 100

function emptyTables(): Record<StagingTableName, StagingRow[]> {
  return Object.fromEntries(STAGING_TABLES.map((name) => [name, [] as StagingRow[]])) as Record<StagingTableName, StagingRow[]>
}

function earliest(values: readonly string[], fallback: string): string {
  let result = ''
  let resultTime = Infinity
  for (const value of values) {
    const time = new Date(value).getTime()
    if (Number.isNaN(time) || time >= resultTime) continue
    result = value
    resultTime = time
  }
  return result || fallback
}

export function buildStagingExport(store: PosStore, options: StagingOptions = {}): StagingExport {
  const outletId = options.outletId?.trim() || store.sync.outletId || LOCAL_OUTLET_ID
  const deviceId = options.deviceId?.trim() || store.sync.deviceId || LOCAL_DEVICE_ID
  const generatedAt = store.sync.updatedAt
  const catalogTimestamp = generatedAt
  const tables = emptyTables()
  const issues: ExportIssue[] = []
  const fail = (code: string, message: string, entityId?: string) => { issues.push({ severity: 'error', code, message, ...(entityId ? { entityId } : {}) }) }
  const warn = (code: string, message: string) => { issues.push({ severity: 'warning', code, message }) }

  // --- Katalog -------------------------------------------------------------
  const categoryIdByName = new Map<string, string>()
  const categoryIds = new Set<string>()
  for (const [index, category] of store.categories.entries()) {
    const key = category.name.trim().toLowerCase()
    if (categoryIds.has(category.id)) { fail('category_duplicate_id', `Kategori ${category.id} muncul lebih dari sekali.`, category.id); continue }
    if (categoryIdByName.has(key)) { fail('category_duplicate_name', `Nama kategori "${category.name}" tidak unik per outlet.`, category.id); continue }
    categoryIds.add(category.id)
    categoryIdByName.set(key, category.id)
    tables.categories.push({
      id: category.id,
      outlet_id: outletId,
      name: category.name.trim(),
      sort_order: index,
      revision: 1,
      created_at: catalogTimestamp,
      updated_at: catalogTimestamp,
      deleted_at: null,
    })
  }

  const menuIds = new Set<string>()
  for (const menu of store.menus) {
    if (menuIds.has(menu.id)) { fail('menu_duplicate_id', `Menu ${menu.id} muncul lebih dari sekali.`, menu.id); continue }
    menuIds.add(menu.id)
    const categoryId = categoryIdByName.get(menu.category.trim().toLowerCase())
    if (!categoryId) fail('menu_missing_category', `Menu "${menu.name}" memakai kategori "${menu.category}" yang tidak ada.`, menu.id)
    tables.menus.push({
      id: menu.id,
      outlet_id: outletId,
      category_id: categoryId ?? '',
      name: menu.name,
      price: menu.price,
      emoji: menu.emoji,
      image_url: menu.imageUrl ?? null,
      active: menu.active,
      revision: 1,
      created_at: catalogTimestamp,
      updated_at: catalogTimestamp,
      deleted_at: null,
    })
  }

  const ingredientIds = new Set<string>()
  for (const ingredient of store.ingredients) {
    if (ingredientIds.has(ingredient.id)) { fail('ingredient_duplicate_id', `Bahan ${ingredient.id} muncul lebih dari sekali.`, ingredient.id); continue }
    ingredientIds.add(ingredient.id)
    tables.ingredients.push({
      id: ingredient.id,
      outlet_id: outletId,
      name: ingredient.name,
      unit: ingredient.unit,
      cost_per_unit: ingredient.costPerUnit,
      purchase_unit: ingredient.purchaseUnit,
      purchase_price: ingredient.purchasePrice,
      usage_per_purchase_unit: ingredient.usagePerPurchaseUnit,
      min_stock: ingredient.minStock,
      revision: 1,
      created_at: catalogTimestamp,
      updated_at: catalogTimestamp,
      deleted_at: null,
    })
  }

  // Resep: PK (outlet_id, menu_id, ingredient_id) → baris duplikat digabung.
  let mergedRecipeLines = 0
  for (const menu of store.menus) {
    const totals = new Map<string, number>()
    for (const line of menu.recipe) {
      if (!ingredientIds.has(line.ingredientId)) {
        fail('recipe_missing_ingredient', `Resep ${menu.name} memakai bahan ${line.ingredientId} yang tidak ada.`, menu.id)
        continue
      }
      if (!Number.isFinite(line.qty) || line.qty <= 0) {
        fail('recipe_invalid_qty', `Resep ${menu.name} memiliki jumlah tidak valid untuk ${line.ingredientId}.`, menu.id)
        continue
      }
      const previous = totals.get(line.ingredientId)
      if (previous !== undefined) mergedRecipeLines += 1
      totals.set(line.ingredientId, (previous ?? 0) + line.qty)
    }
    for (const [ingredientId, qty] of totals) {
      tables.menu_recipes.push({ outlet_id: outletId, menu_id: menu.id, ingredient_id: ingredientId, qty: round2(qty) })
    }
  }
  if (mergedRecipeLines > 0) warn('recipe_duplicates_merged', `${mergedRecipeLines} baris resep duplikat digabung agar kunci primer staging tetap valid.`)

  // --- Shift dan pemetaan shift lama --------------------------------------
  const shiftIds = new Set<string>()
  let openShifts = 0
  for (const shift of store.shifts) {
    if (shiftIds.has(shift.id)) { fail('shift_duplicate_id', `Shift ${shift.id} muncul lebih dari sekali.`, shift.id); continue }
    shiftIds.add(shift.id)
    if (shift.status === 'open') openShifts += 1
    tables.shifts.push({
      id: shift.id,
      outlet_id: outletId,
      opened_at: shift.openedAt,
      closed_at: shift.closedAt ?? null,
      opening_float: shift.openingFloat,
      actual_cash: shift.actualCash ?? null,
      status: shift.status,
      device_id: deviceId,
      revision: 1,
      created_at: shift.openedAt,
      updated_at: shift.closedAt ?? shift.openedAt,
    })
  }

  const orphanTimes = [
    ...store.transactions.filter((item) => !shiftIds.has(item.shiftId)).map((item) => item.createdAt),
    ...store.cashMovements.filter((item) => !shiftIds.has(item.shiftId)).map((item) => item.createdAt),
  ]
  let legacyShiftId: string | null = null
  if (orphanTimes.length > 0) {
    legacyShiftId = LEGACY_SHIFT_ID
    let suffix = 2
    while (shiftIds.has(legacyShiftId)) legacyShiftId = `${LEGACY_SHIFT_ID}-${suffix++}`
    const openedAt = earliest(orphanTimes, generatedAt)
    tables.shifts.push({
      id: legacyShiftId,
      outlet_id: outletId,
      opened_at: openedAt,
      closed_at: null,
      opening_float: 0,
      actual_cash: null,
      status: 'closed',
      device_id: deviceId,
      revision: 1,
      created_at: openedAt,
      updated_at: openedAt,
    })
    shiftIds.add(legacyShiftId)
    warn('legacy_shift_synthesized', `${orphanTimes.length} transaksi/kas tanpa shift dipetakan ke ${legacyShiftId} (opening float 0).`)
  }
  if (openShifts > 1) fail('multiple_open_shifts', `${openShifts} shift berstatus open; Supabase hanya mengizinkan satu per outlet.`)
  const resolveShift = (shiftId: string): string => shiftIds.has(shiftId) ? shiftId : legacyShiftId ?? shiftId

  // --- Transaksi -----------------------------------------------------------
  const transactionIds = new Set<string>()
  const transactionNumbers = new Set<string>()
  for (const transaction of store.transactions) {
    if (transactionIds.has(transaction.id)) { fail('transaction_duplicate_id', `Transaksi ${transaction.id} muncul lebih dari sekali.`, transaction.id); continue }
    transactionIds.add(transaction.id)
    if (transactionNumbers.has(transaction.number)) fail('transaction_duplicate_number', `Nomor transaksi ${transaction.number} tidak unik per outlet.`, transaction.id)
    transactionNumbers.add(transaction.number)
    tables.transactions.push({
      id: transaction.id,
      outlet_id: outletId,
      number: transaction.number,
      created_at: transaction.createdAt,
      order_type: transaction.orderType,
      payment_method: transaction.paymentMethod,
      subtotal: transaction.subtotal,
      paid_amount: transaction.paidAmount,
      change_amount: transaction.change,
      status: transaction.status,
      note: transaction.note ?? null,
      status_reason: transaction.statusReason ?? null,
      status_changed_at: transaction.statusChangedAt ?? null,
      shift_id: resolveShift(transaction.shiftId),
      device_id: deviceId,
      revision: 1,
      created_at_server: transaction.createdAt,
      updated_at: transaction.statusChangedAt ?? transaction.createdAt,
    })
    for (const [index, line] of transaction.items.entries()) {
      const lineNo = index + 1
      tables.transaction_items.push({
        id: `${transaction.id}:${lineNo}`,
        outlet_id: outletId,
        transaction_id: transaction.id,
        line_no: lineNo,
        menu_id: line.id,
        name: line.name,
        category: line.category,
        price: line.price,
        qty: line.qty,
        emoji: line.emoji ?? null,
        image_url: line.imageUrl ?? null,
      })
    }
  }

  // --- Kas, stok, beban ----------------------------------------------------
  const cashIds = new Set<string>()
  for (const movement of store.cashMovements) {
    if (cashIds.has(movement.id)) { fail('cash_duplicate_id', `Kas ${movement.id} muncul lebih dari sekali.`, movement.id); continue }
    cashIds.add(movement.id)
    tables.cash_movements.push({
      id: movement.id,
      outlet_id: outletId,
      shift_id: resolveShift(movement.shiftId),
      type: movement.type,
      amount: movement.amount,
      note: movement.note,
      device_id: deviceId,
      revision: 1,
      created_at: movement.createdAt,
      created_at_server: movement.createdAt,
    })
  }

  const stockIds = new Set<string>()
  for (const movement of store.stockMovements) {
    if (stockIds.has(movement.id)) { fail('stock_duplicate_id', `Pergerakan stok ${movement.id} muncul lebih dari sekali.`, movement.id); continue }
    stockIds.add(movement.id)
    if (!ingredientIds.has(movement.ingredientId)) fail('stock_missing_ingredient', `Pergerakan stok ${movement.id} memakai bahan ${movement.ingredientId} yang tidak ada.`, movement.id)
    tables.stock_movements.push({
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
      device_id: deviceId,
      revision: 1,
      created_at: movement.createdAt,
      created_at_server: movement.createdAt,
    })
  }

  const expenseIds = new Set<string>()
  for (const expense of store.expenses) {
    if (expenseIds.has(expense.id)) { fail('expense_duplicate_id', `Beban ${expense.id} muncul lebih dari sekali.`, expense.id); continue }
    expenseIds.add(expense.id)
    tables.expenses.push({
      id: expense.id,
      outlet_id: outletId,
      category: expense.category,
      amount: expense.amount,
      note: expense.note,
      device_id: deviceId,
      revision: 1,
      created_at: expense.createdAt,
      created_at_server: expense.createdAt,
    })
  }

  // --- Pre-order -----------------------------------------------------------
  const preorderIds = new Set<string>()
  for (const order of store.preOrders) {
    if (preorderIds.has(order.id)) { fail('preorder_duplicate_id', `Pre-order ${order.id} muncul lebih dari sekali.`, order.id); continue }
    preorderIds.add(order.id)
    let transactionId: string | null = order.transactionId ?? null
    if (transactionId && !transactionIds.has(transactionId)) {
      warn('preorder_missing_transaction', `Pre-order ${order.id} merujuk transaksi ${transactionId} yang tidak ada; referensi dikosongkan.`)
      transactionId = null
    }
    tables.preorders.push({
      id: order.id,
      outlet_id: outletId,
      customer_name: order.customerName,
      pickup_at: order.pickupAt,
      order_type: order.orderType,
      total: order.total,
      dp: order.dp,
      payment_method: order.paymentMethod,
      status: order.status,
      note: order.note ?? null,
      transaction_id: transactionId,
      device_id: deviceId,
      revision: 1,
      created_at: order.createdAt,
      updated_at: order.createdAt,
    })
    for (const [index, line] of order.items.entries()) {
      const lineNo = index + 1
      tables.preorder_items.push({
        id: `${order.id}:${lineNo}`,
        outlet_id: outletId,
        preorder_id: order.id,
        line_no: lineNo,
        menu_id: line.id,
        name: line.name,
        category: line.category,
        price: line.price,
        qty: line.qty,
        emoji: line.emoji ?? null,
        image_url: line.imageUrl ?? null,
      })
    }
  }

  // --- Audit ---------------------------------------------------------------
  const auditIds = new Set<string>()
  for (const entry of store.auditLog) {
    if (auditIds.has(entry.id)) { fail('audit_duplicate_id', `Audit ${entry.id} muncul lebih dari sekali.`, entry.id); continue }
    auditIds.add(entry.id)
    tables.audit_log.push({
      id: entry.id,
      outlet_id: outletId,
      actor_id: null,
      action: entry.action,
      detail: entry.detail,
      entity_type: null,
      entity_id: null,
      device_id: deviceId,
      created_at: entry.createdAt,
    })
  }

  // --- Akun dan jurnal (diturunkan, bukan sumber lokal) --------------------
  const accountCodes = new Set<string>()
  for (const account of chartOfAccounts) {
    accountCodes.add(account.code)
    tables.accounts.push({ code: account.code, name: account.name, type: account.type })
  }

  const journals = buildJournals({
    transactions: store.transactions,
    cashMovements: store.cashMovements,
    stockMovements: store.stockMovements,
    expenses: store.expenses,
    hppOf: (transaction) => cogsForTransactions([transaction], store.menus, store.ingredients),
  })
  const entryIds = new Set<string>()
  let journalLines = 0
  for (const entry of journals) {
    if (entryIds.has(entry.id)) { fail('journal_duplicate_id', `Jurnal ${entry.id} muncul lebih dari sekali.`, entry.id); continue }
    entryIds.add(entry.id)
    const suffix = `-${entry.source}`
    const sourceId = entry.id.endsWith(suffix) ? entry.id.slice(0, -suffix.length) : ''
    if (!sourceId) fail('journal_missing_source', `Jurnal ${entry.id} tidak memiliki sumber yang bisa dipetakan.`, entry.id)
    tables.journal_entries.push({
      id: entry.id,
      outlet_id: outletId,
      date: entry.date,
      description: entry.description,
      source_type: entry.source,
      source_id: sourceId,
      posted_at: entry.date,
    })
    for (const [index, line] of entry.lines.entries()) {
      journalLines += 1
      if (!accountCodes.has(line.account)) fail('journal_unknown_account', `Jurnal ${entry.id} memakai akun ${line.account} yang tidak ada.`, entry.id)
      if (!Number.isFinite(line.debit) || !Number.isFinite(line.credit) || line.debit < 0 || line.credit < 0 || (line.debit === 0) === (line.credit === 0)) {
        fail('journal_invalid_line', `Baris ${index + 1} jurnal ${entry.id} tidak valid (debit/credit harus tepat satu > 0).`, entry.id)
      }
      tables.journal_lines.push({
        id: `${entry.id}:${index + 1}`,
        outlet_id: outletId,
        entry_id: entry.id,
        account_code: line.account,
        debit: line.debit,
        credit: line.credit,
      })
    }
  }

  // --- Identitas, pengaturan, counter -------------------------------------
  tables.outlets.push({
    id: outletId,
    name: store.settings.outletName,
    timezone: 'Asia/Jakarta',
    currency: 'IDR',
    created_at: catalogTimestamp,
  })
  tables.outlet_settings.push({
    outlet_id: outletId,
    business_name: store.settings.businessName,
    outlet_name: store.settings.outletName,
    receipt_footer: store.settings.receiptFooter,
    paper_width: store.settings.printer.paperWidth,
    header_align: store.settings.printer.headerAlign,
    footer_align: store.settings.printer.footerAlign,
    font_size: store.settings.printer.fontSize,
    show_order_type: store.settings.printer.showOrderType,
    show_payment_detail: store.settings.printer.showPaymentDetail,
    copies: store.settings.printer.copies,
    app_schema_version: store.schemaVersion,
    revision: store.sync.revision,
    updated_at: store.sync.updatedAt,
  })
  tables.outlet_counters.push({ outlet_id: outletId, next_transaction_number: store.nextTransactionNumber })

  // --- Angka kontrol -------------------------------------------------------
  const effectiveShiftId = (shiftId: string) => resolveShift(shiftId)
  const completed = store.transactions.filter((item) => item.status === 'completed')
  const cashSalesFor = (shiftId: string) => completed
    .filter((item) => effectiveShiftId(item.shiftId) === shiftId && item.paymentMethod === 'Cash')
    .reduce((sum, item) => sum + Math.max(0, item.paidAmount - item.change), 0)
  const cashFor = (shiftId: string, type: 'in' | 'out') => store.cashMovements
    .filter((item) => effectiveShiftId(item.shiftId) === shiftId && item.type === type)
    .reduce((sum, item) => sum + item.amount, 0)

  const shiftControl: ShiftControl[] = tables.shifts.map((row) => {
    const shiftId = String(row.id)
    const openingFloat = Number(row.opening_float)
    const cashSales = round2(cashSalesFor(shiftId))
    const cashIn = round2(cashFor(shiftId, 'in'))
    const cashOut = round2(cashFor(shiftId, 'out'))
    const expectedCash = round2(openingFloat + cashSales + cashIn - cashOut)
    const actualRaw = row.actual_cash
    const actualCash = typeof actualRaw === 'number' && Number.isFinite(actualRaw) ? actualRaw : null
    return {
      shiftId,
      status: String(row.status),
      openingFloat,
      cashSales,
      cashIn,
      cashOut,
      expectedCash,
      actualCash,
      variance: actualCash !== null && row.status === 'closed' ? round2(actualCash - expectedCash) : null,
    }
  })

  const money = {
    revenue: round2(completed.reduce((sum, item) => sum + item.subtotal, 0)),
    paid: round2(completed.reduce((sum, item) => sum + item.paidAmount, 0)),
    change: round2(completed.reduce((sum, item) => sum + item.change, 0)),
    cashSales: round2(shiftControl.reduce((sum, item) => sum + item.cashSales, 0)),
    qrisSales: round2(completed.filter((item) => item.paymentMethod === 'QRIS').reduce((sum, item) => sum + item.subtotal, 0)),
    unpaidSales: round2(completed.filter((item) => item.paymentMethod === 'Unpaid').reduce((sum, item) => sum + item.subtotal, 0)),
  }

  const trial = trialBalance(journals)
  const control: StagingControl = {
    transactions: {
      total: store.transactions.length,
      completed: completed.length,
      cancelled: store.transactions.filter((item) => item.status === 'cancelled').length,
      refunded: store.transactions.filter((item) => item.status === 'refunded').length,
    },
    money,
    shifts: shiftControl,
    journals: {
      entries: journals.length,
      lines: journalLines,
      debit: round2(trial.debit),
      credit: round2(trial.credit),
      balanced: trial.balanced,
    },
    inventory: {
      purchaseValue: round2(store.stockMovements.filter((item) => item.type === 'purchase').reduce((sum, item) => sum + item.totalCost, 0)),
      opnameAdjustment: round2(store.stockMovements
        .filter((item) => item.type === 'opname')
        .reduce((sum, item) => sum + Math.round(Math.abs(item.qty) * (item.unitCost ?? 0) * 100) / 100, 0)),
    },
  }

  if (!trial.balanced) fail('journal_unbalanced', `Jurnal tidak seimbang: debit ${trial.debit} vs kredit ${trial.credit}.`)

  const counts = Object.fromEntries(STAGING_TABLES.map((name) => [name, tables[name].length])) as Record<StagingTableName, number>
  const manifest: StagingManifest = {
    format: STAGING_FORMAT,
    formatVersion: STAGING_FORMAT_VERSION,
    generatedAt,
    outletId,
    deviceId,
    appSchemaVersion: store.schemaVersion,
    counts,
    sourceCounts: {
      transactions: store.transactions.length,
      cashMovements: store.cashMovements.length,
      shifts: store.shifts.length,
      preOrders: store.preOrders.length,
      menus: store.menus.length,
      categories: store.categories.length,
      ingredients: store.ingredients.length,
      stockMovements: store.stockMovements.length,
      expenses: store.expenses.length,
      auditLog: store.auditLog.length,
      heldOrders: store.heldOrders.length,
    },
    excluded: { heldOrders: store.heldOrders.length },
    ids: {
      categories: tables.categories.map((row) => String(row.id)),
      menus: tables.menus.map((row) => String(row.id)),
      ingredients: tables.ingredients.map((row) => String(row.id)),
      transactions: tables.transactions.map((row) => String(row.id)),
      shifts: tables.shifts.map((row) => String(row.id)),
    },
    derived: { catalogTimestamp, legacyShiftId },
    control,
    issues,
  }

  return { tables, manifest }
}
