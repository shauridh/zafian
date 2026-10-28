import { SCHEMA_VERSION, type PosStore } from '../domain/pos'
import { createId } from './id'
import { normalizeStore } from './schema'
import { BACKUP_STORAGE_KEY, isStorageReady, readJson, writeJson } from './storage'

export const BACKUP_FORMAT = 'sabana-pos-backup'
export const BACKUP_FORMAT_VERSION = 1

export type BackupReason = 'daily' | 'before-shift-close' | 'manual' | 'legacy'

export type BackupSummary = {
  transactions: number
  menus: number
  ingredients: number
  categories: number
  shifts: number
  outletName: string
  businessName: string
}

export type BackupRecord = {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  schemaVersion: number
  createdAt: string
  reason: BackupReason
  summary: BackupSummary
  store: PosStore
}

export type BackupMeta = Omit<BackupRecord, 'store'>

export type BackupInspection =
  | { ok: true; store: PosStore; meta: BackupMeta }
  | { ok: false; error: string }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isDateString = (value: unknown): value is string => isNonEmptyString(value) && !Number.isNaN(new Date(value).getTime())

function summarize(store: PosStore): BackupSummary {
  return {
    transactions: store.transactions.length,
    menus: store.menus.length,
    ingredients: store.ingredients.length,
    categories: store.categories.length,
    shifts: store.shifts.length,
    outletName: store.settings.outletName,
    businessName: store.settings.businessName,
  }
}

export function createBackupRecord(store: PosStore, reason: BackupReason = 'manual', createdAt = new Date().toISOString()): BackupRecord {
  const normalized = normalizeStore(store)
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: normalized.schemaVersion,
    createdAt,
    reason,
    summary: summarize(normalized),
    store: normalized,
  }
}

export function serializeBackup(record: BackupRecord): string {
  return JSON.stringify(record, null, 2)
}

export function backupFileName(record: BackupRecord): string {
  const date = record.createdAt.slice(0, 10) || new Date().toISOString().slice(0, 10)
  return `sabana-pos-backup-${date}-${record.reason}.json`
}

export function downloadBackup(record: BackupRecord): void {
  const blob = new Blob([serializeBackup(record)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = backupFileName(record)
  anchor.click()
  URL.revokeObjectURL(url)
}

function validateArray(value: unknown, name: string): string | null {
  if (!Array.isArray(value)) return `${name} bukan array.`
  if (value.some((item) => !isObject(item))) return `${name} berisi entri yang bukan objek.`
  return null
}

/**
 * Validasi struktur sebelum normalisasi. Ini sengaja lebih ketat daripada
 * normalizeStore agar file rusak tidak "diperbaiki" diam-diam menjadi data
 * kosong. Field lama seperti paidAmount/change tetap boleh tidak ada.
 */
function validateStoreShape(value: unknown): string | null {
  if (!isObject(value)) return 'Objek state tidak ditemukan.'
  if (!isFiniteNumber(value.schemaVersion) || !Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) return 'Versi skema state tidak valid.'
  if (value.schemaVersion > SCHEMA_VERSION) return `Backup memakai skema v${value.schemaVersion}, sedangkan aplikasi hanya mendukung sampai v${SCHEMA_VERSION}.`
  if (!isObject(value.settings)) return 'Pengaturan tidak ditemukan.'

  const arrayFields = ['transactions', 'cashMovements', 'shifts', 'heldOrders', 'preOrders', 'menus', 'ingredients', 'categories', 'stockMovements', 'expenses', 'auditLog']
  for (const field of arrayFields) {
    const error = validateArray(value[field], field)
    if (error) return error
  }
  if (!isFiniteNumber(value.nextTransactionNumber)) return 'Nomor transaksi berikutnya tidak valid.'

  const transactions = value.transactions as unknown[]
  for (const [index, raw] of transactions.entries()) {
    if (!isObject(raw)) return `Transaksi ke-${index + 1} bukan objek.`
    if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.number)) return `Transaksi ke-${index + 1} tidak memiliki id/nomor.`
    if (!isDateString(raw.createdAt)) return `Tanggal transaksi ke-${index + 1} tidak valid.`
    if (!Array.isArray(raw.items)) return `Item transaksi ke-${index + 1} tidak valid.`
    for (const [itemIndex, item] of raw.items.entries()) {
      if (!isObject(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.name)) return `Item ke-${itemIndex + 1} pada transaksi ke-${index + 1} tidak valid.`
      if (!isFiniteNumber(item.price) || item.price < 0 || !isFiniteNumber(item.qty) || item.qty <= 0) return `Harga/jumlah item ke-${itemIndex + 1} pada transaksi ke-${index + 1} tidak valid.`
    }
    if (!isFiniteNumber(raw.subtotal) || raw.subtotal < 0) return `Subtotal transaksi ke-${index + 1} tidak valid.`
    if (!['completed', 'cancelled', 'refunded'].includes(String(raw.status))) return `Status transaksi ke-${index + 1} tidak valid.`
  }

  const menus = value.menus as unknown[]
  for (const [index, raw] of menus.entries()) {
    if (!isObject(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.name) || !isNonEmptyString(raw.category)) return `Menu ke-${index + 1} tidak valid.`
    if (!isFiniteNumber(raw.price) || raw.price < 0) return `Harga menu ke-${index + 1} tidak valid.`
  }

  const ingredients = value.ingredients as unknown[]
  for (const [index, raw] of ingredients.entries()) {
    if (!isObject(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.name) || !isNonEmptyString(raw.unit)) return `Bahan ke-${index + 1} tidak valid.`
    if (!isFiniteNumber(raw.costPerUnit) || raw.costPerUnit < 0) return `Biaya bahan ke-${index + 1} tidak valid.`
  }

  const categories = value.categories as unknown[]
  for (const [index, raw] of categories.entries()) {
    if (!isObject(raw) || !isNonEmptyString(raw.name)) return `Kategori ke-${index + 1} tidak valid.`
  }

  const expectedCounts: [string, number][] = [
    ['transactions', transactions.length],
    ['cashMovements', (value.cashMovements as unknown[]).length],
    ['shifts', (value.shifts as unknown[]).length],
    ['heldOrders', (value.heldOrders as unknown[]).length],
    ['preOrders', (value.preOrders as unknown[]).length],
    ['menus', menus.length],
    ['ingredients', ingredients.length],
    ['categories', categories.length],
    ['stockMovements', (value.stockMovements as unknown[]).length],
    ['expenses', (value.expenses as unknown[]).length],
    ['auditLog', (value.auditLog as unknown[]).length],
  ]
  const normalized = normalizeStore(value)
  const actual: Record<string, number> = {
    transactions: normalized.transactions.length,
    cashMovements: normalized.cashMovements.length,
    shifts: normalized.shifts.length,
    heldOrders: normalized.heldOrders.length,
    preOrders: normalized.preOrders.length,
    menus: normalized.menus.length,
    ingredients: normalized.ingredients.length,
    categories: normalized.categories.length,
    stockMovements: normalized.stockMovements.length,
    expenses: normalized.expenses.length,
    auditLog: normalized.auditLog.length,
  }
  for (const [field, count] of expectedCounts) {
    if (actual[field] !== count) return `Sebagian ${field} tidak valid; restore dibatalkan agar data tidak hilang.`
  }
  return null
}

function metaFromStore(store: PosStore, createdAt: string, reason: BackupReason, schemaVersion: number): BackupMeta {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion,
    createdAt,
    reason,
    summary: summarize(store),
  }
}

export function inspectBackupValue(value: unknown): BackupInspection {
  if (!isObject(value)) return { ok: false, error: 'File backup bukan objek JSON.' }

  if (value.format !== undefined) {
    if (value.format !== BACKUP_FORMAT) return { ok: false, error: 'Format backup tidak dikenal.' }
    if (value.formatVersion !== BACKUP_FORMAT_VERSION) return { ok: false, error: `Versi format backup tidak didukung (${String(value.formatVersion)}).` }
    if (!isFiniteNumber(value.schemaVersion) || !Number.isInteger(value.schemaVersion)) return { ok: false, error: 'Versi skema backup tidak valid.' }
    if (!isDateString(value.createdAt)) return { ok: false, error: 'Timestamp backup tidak valid.' }
    if (!isObject(value.store)) return { ok: false, error: 'Isi backup tidak ditemukan.' }
    if (value.schemaVersion > SCHEMA_VERSION) return { ok: false, error: `Backup memakai skema v${value.schemaVersion}, sedangkan aplikasi mendukung v${SCHEMA_VERSION}.` }
    if (isFiniteNumber(value.store.schemaVersion) && value.store.schemaVersion !== value.schemaVersion) return { ok: false, error: 'Versi skema backup dan isinya tidak cocok.' }
    const shapeError = validateStoreShape(value.store)
    if (shapeError) return { ok: false, error: shapeError }
    const store = normalizeStore(value.store)
    return {
      ok: true,
      store,
      meta: metaFromStore(store, value.createdAt, (value.reason as BackupReason | undefined) ?? 'manual', value.schemaVersion),
    }
  }

  // Kompatibilitas dengan file backup lama yang hanya berisi state mentah.
  const shapeError = validateStoreShape(value)
  if (shapeError) return { ok: false, error: shapeError }
  const version = value.schemaVersion as number
  const store = normalizeStore(value)
  return {
    ok: true,
    store,
    meta: metaFromStore(store, '', 'legacy', version),
  }
}

export function inspectBackup(raw: string): BackupInspection {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `JSON tidak valid: ${error.message}` : 'JSON tidak valid.' }
  }
  return inspectBackupValue(parsed)
}

export async function createAndStoreBackup(store: PosStore, reason: BackupReason = 'manual', now = new Date()): Promise<BackupRecord> {
  const record = createBackupRecord(store, reason, now.toISOString())
  await writeJson(BACKUP_STORAGE_KEY, record)
  return record
}

export function applyRestoredStore(restored: PosStore, current: PosStore, fileName: string): PosStore {
  // PIN perangkat saat ini tidak diganti oleh backup lama agar pemilik tidak terkunci.
  const withPin = current.settings.ownerPin
    ? { ...restored, settings: { ...restored.settings, ownerPin: current.settings.ownerPin } }
    : restored
  return {
    ...withPin,
    auditLog: [...withPin.auditLog, {
      id: createId(),
      createdAt: new Date().toISOString(),
      action: 'restore',
      detail: `Restore ${fileName} • ${withPin.transactions.length} transaksi`,
    }],
  }
}

export function localDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function readLatestBackup(): Promise<BackupRecord | null> {
  const value = await readJson<unknown>(BACKUP_STORAGE_KEY)
  if (value === undefined) return null
  const inspected = inspectBackupValue(value)
  if (!inspected.ok) throw new Error(`Backup terakhir rusak: ${inspected.error}`)
  return {
    ...inspected.meta,
    store: inspected.store,
  }
}

let dailyPromise: Promise<{ created: boolean; record?: BackupRecord }> | null = null

export function ensureDailyBackup(store: PosStore, now = new Date()): Promise<{ created: boolean; record?: BackupRecord }> {
  if (!isStorageReady()) return Promise.resolve({ created: false })
  if (dailyPromise) return dailyPromise
  dailyPromise = (async () => {
    const latest = await readLatestBackup()
    if (latest && latest.createdAt && localDayKey(latest.createdAt) === localDayKey(now)) return { created: false }
    const record = await createAndStoreBackup(store, 'daily', now)
    return { created: true, record }
  })().finally(() => { dailyPromise = null })
  return dailyPromise
}
