import type { PosStore, CartItem } from '../../domain/pos'
import { normalizeStore } from '../schema'
import type { RepoGateway, Row, TableName } from './gateway'
import {
  categoryFromRow,
  categoryRow,
  documentRow,
  documentsFromRows,
  documentsFromStore,
  DOCUMENT_KEYS,
  ingredientFromRow,
  ingredientRow,
  menuFromRow,
  menuRow,
  rowSignature,
  settingsRow,
  shiftFromRow,
  shiftRow,
  stockMovementFromRow,
  stockMovementRow,
  transactionFromRow,
  transactionRow,
} from './mappers'

type Collection = {
  table: Exclude<TableName, 'app_settings' | 'pos_documents'>
  rows: (store: PosStore, outletId: string) => Row[]
}

const collections: Collection[] = [
  { table: 'menu_categories', rows: (store, outletId) => store.categories.map((category) => categoryRow(category, outletId)) },
  { table: 'ingredient_categories', rows: (store, outletId) => store.ingredientCategories.map((category) => categoryRow(category, outletId)) },
  { table: 'menu_items', rows: (store, outletId) => store.menus.map((menu) => menuRow(menu, outletId)) },
  { table: 'ingredients', rows: (store, outletId) => store.ingredients.map((ingredient) => ingredientRow(ingredient, outletId)) },
  { table: 'stock_movements', rows: (store, outletId) => store.stockMovements.map((movement) => stockMovementRow(movement, outletId)) },
  { table: 'shifts', rows: (store, outletId) => store.shifts.map((shift) => shiftRow(shift, outletId)) },
  { table: 'transactions', rows: (store, outletId) => store.transactions.map((transaction) => transactionRow(transaction, outletId)) },
]

/**
 * Membaca seluruh data outlet dari Supabase. Mengembalikan null bila outlet
 * benar-benar kosong (belum punya app_settings dan belum punya baris data),
 * sehingga pemanggil bisa melakukan seed awal.
 */
export async function loadStore(gateway: RepoGateway, outletId: string): Promise<PosStore | null> {
  const [settingsRows, documentRows, ...collectionRows] = await Promise.all([
    gateway.list('app_settings', outletId),
    gateway.list('pos_documents', outletId),
    ...collections.map((collection) => gateway.list(collection.table, outletId)),
  ])

  const rowsByTable = new Map<TableName, Row[]>()
  collections.forEach((collection, index) => rowsByTable.set(collection.table, collectionRows[index] ?? []))

  const dataRowCount = collectionRows.reduce((sum, rows) => sum + rows.length, 0)
  if (settingsRows.length === 0 && documentRows.length === 0 && dataRowCount === 0) return null

  const documents = documentsFromRows(documentRows)
  const settingsRow = settingsRows[0] ?? {}

  return normalizeStore({
    menus: (rowsByTable.get('menu_items') ?? []).map(menuFromRow),
    categories: (rowsByTable.get('menu_categories') ?? []).map(categoryFromRow),
    ingredients: (rowsByTable.get('ingredients') ?? []).map(ingredientFromRow),
    ingredientCategories: (rowsByTable.get('ingredient_categories') ?? []).map(categoryFromRow),
    stockMovements: (rowsByTable.get('stock_movements') ?? []).map(stockMovementFromRow),
    shifts: (rowsByTable.get('shifts') ?? []).map(shiftFromRow),
    transactions: (rowsByTable.get('transactions') ?? []).map(transactionFromRow),
    heldOrders: documents.held_orders ?? [],
    preOrders: documents.pre_orders ?? [],
    cashMovements: documents.cash_movements ?? [],
    expenses: documents.expenses ?? [],
    auditLog: documents.audit_log ?? [],
    settings: settingsRow.data,
    // nextTransactionNumber sengaja tidak dibaca dari database: normalizeStore
    // menurunkannya dari nomor transaksi terakhir (aman untuk multi-perangkat).
  }, { seed: false })
}

export type SaveSummary = {
  inserted: number
  updated: number
  deleted: number
  documents: number
}

/**
 * Menyimpan perubahan dengan membandingkan snapshot sebelumnya. Hanya baris yang
 * berubah yang dikirim (upsert), baris yang hilang dihapus, dan konflik antar
 * perangkat diselesaikan last-write-wins lewat `updated_at` di server.
 */
export async function saveStore(
  gateway: RepoGateway,
  outletId: string,
  next: PosStore,
  previous: PosStore | null,
  now = new Date().toISOString(),
): Promise<SaveSummary> {
  const summary: SaveSummary = { inserted: 0, updated: 0, deleted: 0, documents: 0 }

  for (const collection of collections) {
    const nextRows = collection.rows(next, outletId)
    const previousRows = previous ? collection.rows(previous, outletId) : []
    const previousById = new Map(previousRows.map((row) => [String(row.id), row]))
    const nextById = new Map(nextRows.map((row) => [String(row.id), row]))

    const upserts: Row[] = []
    for (const [id, row] of nextById) {
      const before = previousById.get(id)
      if (!before) {
        upserts.push({ ...row, updated_at: now })
        summary.inserted += 1
        continue
      }
      if (rowSignature(collection.table, row) !== rowSignature(collection.table, before)) {
        upserts.push({ ...row, updated_at: now })
        summary.updated += 1
      }
    }

    const removedIds = [...previousById.keys()].filter((id) => !nextById.has(id))
    if (upserts.length > 0) await gateway.upsert(collection.table, upserts)
    if (removedIds.length > 0) {
      await gateway.remove(collection.table, outletId, removedIds)
      summary.deleted += removedIds.length
    }
  }

  const nextSettings = settingsRow(next.settings, outletId)
  const previousSettings = previous ? settingsRow(previous.settings, outletId) : null
  if (!previousSettings || rowSignature('app_settings', nextSettings) !== rowSignature('app_settings', previousSettings)) {
    await gateway.upsert('app_settings', [{ ...nextSettings, updated_at: now }])
    summary.updated += 1
  }

  const nextDocuments = documentsFromStore(next)
  const previousDocuments = previous ? documentsFromStore(previous) : null
  const changed = DOCUMENT_KEYS.filter((key) => !previousDocuments || JSON.stringify(nextDocuments[key]) !== JSON.stringify(previousDocuments[key]))
  if (changed.length > 0) {
    await gateway.upsert('pos_documents', changed.map((key) => ({ ...documentRow(key, nextDocuments[key], outletId), updated_at: now })))
    summary.documents = changed.length
  }

  return summary
}

/* -------------------------------------------------------------------------- */
/* Seed awal dengan ID uuid                                                   */
/* -------------------------------------------------------------------------- */

const fallbackUuid = (): string => {
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Katalog contoh memakai ID slug (mis. "dada"); tabel Supabase memakai uuid.
 * Fungsi ini memberi ID uuid baru sekaligus memperbarui referensi resep/riwayat,
 * dipakai hanya saat outlet masih kosong (seed awal).
 */
export function assignGeneratedIds(store: PosStore, makeId: () => string = () => globalThis.crypto?.randomUUID?.() ?? fallbackUuid()): PosStore {
  const menuIds = new Map(store.menus.map((menu) => [menu.id, makeId()]))
  const ingredientIds = new Map(store.ingredients.map((ingredient) => [ingredient.id, makeId()]))
  const mapItems = (items: CartItem[]): CartItem[] => items.map((item) => ({ ...item, id: menuIds.get(item.id) ?? item.id }))

  return {
    ...store,
    menus: store.menus.map((menu) => ({
      ...menu,
      id: menuIds.get(menu.id) ?? menu.id,
      recipe: menu.recipe.map((line) => ({ ...line, ingredientId: ingredientIds.get(line.ingredientId) ?? line.ingredientId })),
    })),
    categories: store.categories.map((category) => ({ ...category, id: makeId() })),
    ingredientCategories: store.ingredientCategories.map((category) => ({ ...category, id: makeId() })),
    ingredients: store.ingredients.map((ingredient) => ({ ...ingredient, id: ingredientIds.get(ingredient.id) ?? ingredient.id })),
    stockMovements: store.stockMovements.map((movement) => ({ ...movement, ingredientId: ingredientIds.get(movement.ingredientId) ?? movement.ingredientId })),
    transactions: store.transactions.map((transaction) => ({ ...transaction, items: mapItems(transaction.items) })),
    heldOrders: store.heldOrders.map((order) => ({ ...order, items: mapItems(order.items) })),
    preOrders: store.preOrders.map((order) => ({ ...order, items: mapItems(order.items) })),
  }
}
