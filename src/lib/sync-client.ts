/**
 * Fase 3 — pull katalog bertahap + push penjualan (offline-first).
 *
 * Modul ini memperluas lapisan sync yang sudah ada (`domain/sync.ts`,
 * `lib/sync-staging.ts`, `lib/cloud-backup.ts`): konfigurasi, sesi, dan
 * kredensial tetap memakai yang dibuat pada Fase 2 — tidak ada modul login
 * atau koneksi paralel. Aplikasi tetap membaca/menulis IndexedDB; pull hanya
 * memperbarui salinan lokal, dan kegagalan jaringan tidak pernah menahan kasir.
 *
 * Aturan konflik (lihat README):
 * - Master data (kategori, menu, bahan, resep, pengaturan): last-write-wins
 *   berbasis `row_version` + `seq`; versi remote yang lebih tua dilewati.
 * - Baris yang punya perubahan lokal tertunda tidak ditimpa; konflik dicatat.
 * - Ledger (transaksi, kas, shift, stok, jurnal) tidak pernah ditimpa pull;
 *   penjualan dikirim lewat RPC `apply_sale` yang idempoten.
 * - Soft delete (`op = "delete"`) ikut diterapkan sebagai tombstone lokal.
 */

import type { Ingredient, Menu, MenuCategory } from '../domain/catalog'
import type { PosStore, Transaction } from '../domain/pos'
import { ensureDailyBackup } from './backup'
import {
  loadCloudConfig,
  loadCloudSession,
  refreshCloudSession,
  saveCloudSession,
  type CloudBackupConfig,
  type CloudSession,
} from './cloud-backup'
import { createId } from './id'
import { readJson, writeJson } from './storage'

export type SyncEntity = 'category' | 'menu' | 'ingredient' | 'menu_recipe' | 'outlet_settings'
export type SyncOp = 'upsert' | 'delete'

export type SyncChange = {
  seq: number
  entity: SyncEntity
  entityId: string
  op: SyncOp
  rowVersion: number
  payload: Record<string, unknown> | null
  changedAt: string
  deviceId: string | null
}

export type SyncConflict = {
  id: string
  at: string
  entity: SyncEntity
  entityId: string
  reason: string
  remoteVersion: number
  localVersion: number
}

export type AppliedVersions = Record<string, number>

export type OutletSyncState = {
  lastSeq: number
  lastPullAt: string
  appliedVersions: AppliedVersions
}

export type SyncStateFile = {
  version: 1
  outlets: Record<string, OutletSyncState>
}

export type OutboxEntry = {
  id: string
  kind: 'sale'
  outletId: string
  createdAt: string
  payload: Record<string, unknown>
  attempts: number
  lastError?: string
}

export type SyncStatusState = 'disabled' | 'pending-setup' | 'idle' | 'pulling' | 'pushing' | 'ok' | 'error'

export type SyncStatus = {
  state: SyncStatusState
  lastPullAt?: string
  lastSeq?: number
  lastError?: string
  pending: number
  conflicts: number
  realtime: 'off' | 'connected' | 'polling'
}

export type SyncSummary = {
  ok: boolean
  skipped?: 'disabled' | 'no-session'
  changed: boolean
  applied: number
  skippedChanges: number
  conflicts: SyncConflict[]
  nextSeq: number
  pending: number
  error?: string
}

export const SYNC_STATE_KEY = 'sync:state'
export const SYNC_OUTBOX_KEY = 'sync:outbox'
export const SYNC_STATUS_KEY = 'sync:status'
export const SYNC_CONFLICTS_KEY = 'sync:conflicts'
export const DEFAULT_PAGE_LIMIT = 200
export const MAX_PAGES = 25
export const DEFAULT_POLL_MS = 60_000
export const DEFAULT_DEBOUNCE_MS = 1_500

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type SyncDeps = {
  fetchImpl?: FetchLike
  now?: () => Date
}

/* -------------------------------------------------------------------------- */
/* Status (dipakai ikon sync dan panel Backup)                                */
/* -------------------------------------------------------------------------- */

let status: SyncStatus = { state: 'disabled', pending: 0, conflicts: 0, realtime: 'off' }
const listeners = new Set<(value: SyncStatus) => void>()

export function getSyncStatus(): SyncStatus {
  return status
}

export function subscribeSyncStatus(listener: (value: SyncStatus) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function publishSyncStatus(next: Partial<SyncStatus>): SyncStatus {
  status = { ...status, ...next }
  for (const listener of listeners) listener(status)
  void writeJson(SYNC_STATUS_KEY, status).catch((error: unknown) => {
    console.warn('Status sync tidak bisa disimpan', error)
  })
  return status
}

/* -------------------------------------------------------------------------- */
/* Kursor & outbox                                                            */
/* -------------------------------------------------------------------------- */

function emptyState(): SyncStateFile {
  return { version: 1, outlets: {} }
}

export async function readSyncState(): Promise<SyncStateFile> {
  const raw = await readJson<Partial<SyncStateFile>>(SYNC_STATE_KEY)
  if (!raw || typeof raw !== 'object' || !raw.outlets || typeof raw.outlets !== 'object') return emptyState()
  return { version: 1, outlets: raw.outlets as Record<string, OutletSyncState> }
}

export async function writeSyncState(next: SyncStateFile): Promise<void> {
  await writeJson(SYNC_STATE_KEY, next)
}

export function outletStateFor(file: SyncStateFile, outletId: string): OutletSyncState {
  const existing = file.outlets[outletId]
  return {
    lastSeq: Number(existing?.lastSeq) || 0,
    lastPullAt: typeof existing?.lastPullAt === 'string' ? existing.lastPullAt : '',
    appliedVersions: existing?.appliedVersions && typeof existing.appliedVersions === 'object' ? { ...existing.appliedVersions } : {},
  }
}

export async function saveOutletState(outletId: string, next: OutletSyncState): Promise<SyncStateFile> {
  const file = await readSyncState()
  const merged: SyncStateFile = { ...file, outlets: { ...file.outlets, [outletId]: next } }
  await writeSyncState(merged)
  return merged
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  const raw = await readJson<unknown>(SYNC_OUTBOX_KEY)
  return Array.isArray(raw) ? raw.filter((entry): entry is OutboxEntry => Boolean(entry) && typeof entry === 'object' && (entry as OutboxEntry).kind === 'sale') : []
}

export async function writeOutbox(entries: OutboxEntry[]): Promise<void> {
  await writeJson(SYNC_OUTBOX_KEY, entries)
  publishSyncStatus({ pending: entries.length })
}

export async function readConflicts(): Promise<SyncConflict[]> {
  const raw = await readJson<unknown>(SYNC_CONFLICTS_KEY)
  return Array.isArray(raw) ? (raw as SyncConflict[]) : []
}

async function appendConflicts(conflicts: SyncConflict[]): Promise<void> {
  if (conflicts.length === 0) return
  const existing = await readConflicts()
  await writeJson(SYNC_CONFLICTS_KEY, [...conflicts, ...existing].slice(0, 50))
  publishSyncStatus({ conflicts: Math.min(50, existing.length + conflicts.length) })
}

/** Muat status awal dari penyimpanan; dipanggil sekali saat aplikasi dibuka. */
export async function hydrateSyncStatus(): Promise<SyncStatus> {
  const config = await loadCloudConfig()
  const outbox = await readOutbox()
  const conflicts = await readConflicts()
  const state = await readSyncState()
  const outletId = config?.outletId ?? 'outlet-local'
  const outlet = outletStateFor(state, outletId)
  const enabled = Boolean(config?.enabled)
  return publishSyncStatus({
    state: enabled ? 'idle' : 'disabled',
    lastSeq: outlet.lastSeq,
    lastPullAt: outlet.lastPullAt || undefined,
    pending: outbox.length,
    conflicts: conflicts.length,
  })
}

/* -------------------------------------------------------------------------- */
/* Payload konversi                                                           */
/* -------------------------------------------------------------------------- */

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function changeKey(entity: SyncEntity, entityId: string): string {
  return `${entity}:${entityId}`
}

const applyOrder: Record<SyncEntity, number> = {
  category: 0,
  ingredient: 1,
  menu: 2,
  menu_recipe: 3,
  outlet_settings: 4,
}

function categoryFromPayload(payload: Record<string, unknown>): MenuCategory | null {
  const id = str(payload.id)
  const name = str(payload.name).trim()
  if (!id || !name) return null
  return { id, name }
}

function menuFromPayload(payload: Record<string, unknown>, categories: MenuCategory[], previous?: Menu): Menu | null {
  const id = str(payload.id)
  const name = str(payload.name).trim()
  if (!id || !name) return null
  const categoryId = str(payload.category_id)
  const category = categories.find((item) => item.id === categoryId)?.name ?? previous?.category ?? 'Lainnya'
  return {
    id,
    name,
    category,
    price: Math.max(0, num(payload.price)),
    emoji: str(payload.emoji) || previous?.emoji || '🍽️',
    imageUrl: str(payload.image_url) || undefined,
    active: bool(payload.active, true),
    recipe: previous?.recipe ?? [],
  }
}

function ingredientFromPayload(payload: Record<string, unknown>, previous?: Ingredient): Ingredient | null {
  const id = str(payload.id)
  const name = str(payload.name).trim()
  const unit = str(payload.unit).trim()
  if (!id || !name || !unit) return null
  return {
    id,
    name,
    // Kategori bahan sengaja lokal saja (tidak ada kolomnya di skema Supabase).
    category: previous?.category ?? 'Bahan baku',
    unit,
    costPerUnit: Math.max(0, num(payload.cost_per_unit)),
    purchaseUnit: str(payload.purchase_unit),
    purchasePrice: Math.max(0, num(payload.purchase_price)),
    usagePerPurchaseUnit: Math.max(1, num(payload.usage_per_purchase_unit) || 1),
    minStock: Math.max(0, num(payload.min_stock)),
  }
}

export type ApplyValidation = {
  supported: boolean
  reason?: string
}

/** Validasi ringan sebelum menimpa baris lokal. */
export function validateChange(change: SyncChange): ApplyValidation {
  if (!change.entity || !(change.entity in applyOrder)) return { supported: false, reason: `entitas ${String(change.entity)} tidak didukung` }
  if (!change.entityId) return { supported: false, reason: 'entity_id kosong' }
  if (change.op === 'delete') return { supported: true }
  const payload = change.payload
  if (!payload || typeof payload !== 'object') return { supported: false, reason: 'payload kosong' }
  if (change.entity === 'outlet_settings') return { supported: Boolean(str(payload.outlet_id)) }
  if (change.entity === 'menu_recipe') return { supported: num(payload.qty) > 0, reason: 'qty resep tidak valid' }
  return { supported: Boolean(str(payload.id)) }
}

export type ApplyResult = {
  store: PosStore
  appliedVersions: AppliedVersions
  applied: number
  skipped: number
  conflicts: SyncConflict[]
}

/**
 * Terapkan perubahan remote ke store lokal. Fungsi murni: tidak menyentuh
 * penyimpanan dan tidak mengubah input.
 */
export function applyChanges(
  store: PosStore,
  changes: SyncChange[],
  options: { appliedVersions?: AppliedVersions; pendingEntities?: Iterable<string>; now?: Date } = {},
): ApplyResult {
  const appliedVersions: AppliedVersions = { ...(options.appliedVersions ?? {}) }
  const pending = new Set(options.pendingEntities ?? [])
  const conflicts: SyncConflict[] = []
  const nowIso = (options.now ?? new Date()).toISOString()

  let categories = store.categories
  let menus = store.menus
  let ingredients = store.ingredients
  let settings = store.settings
  let changed = false
  let applied = 0
  let skipped = 0

  const sorted = [...changes].sort((a, b) => {
    const order = applyOrder[a.entity] - applyOrder[b.entity]
    return order !== 0 ? order : a.seq - b.seq
  })

  const conflict = (change: SyncChange, reason: string, localVersion: number) => {
    conflicts.push({
      id: createId(),
      at: nowIso,
      entity: change.entity,
      entityId: change.entityId,
      reason,
      remoteVersion: change.rowVersion,
      localVersion,
    })
  }

  for (const change of sorted) {
    const key = changeKey(change.entity, change.entityId)
    const localVersion = appliedVersions[key] ?? 0
    const validation = validateChange(change)

    if (!validation.supported) {
      conflict(change, validation.reason ?? 'perubahan tidak didukung', localVersion)
      continue
    }
    if (change.rowVersion <= localVersion) {
      skipped += 1
      continue
    }
    if (pending.has(key)) {
      conflict(change, 'perubahan lokal belum terkirim; versi remote ditolak', localVersion)
      continue
    }

    if (change.entity === 'category') {
      if (change.op === 'delete') {
        const next = categories.filter((item) => item.id !== change.entityId)
        if (next.length !== categories.length) { categories = next; changed = true }
      } else {
        const parsed = categoryFromPayload(change.payload ?? {})
        if (!parsed) { conflict(change, 'payload kategori tidak valid', localVersion); continue }
        const exists = categories.some((item) => item.id === parsed.id)
        categories = exists ? categories.map((item) => item.id === parsed.id ? parsed : item) : [...categories, parsed]
        changed = true
      }
    } else if (change.entity === 'menu') {
      if (change.op === 'delete') {
        const next = menus.filter((item) => item.id !== change.entityId)
        if (next.length !== menus.length) { menus = next; changed = true }
      } else {
        const previous = menus.find((item) => item.id === change.entityId)
        const parsed = menuFromPayload(change.payload ?? {}, categories, previous)
        if (!parsed) { conflict(change, 'payload menu tidak valid', localVersion); continue }
        menus = previous ? menus.map((item) => item.id === parsed.id ? parsed : item) : [...menus, parsed]
        changed = true
      }
    } else if (change.entity === 'ingredient') {
      if (change.op === 'delete') {
        const next = ingredients.filter((item) => item.id !== change.entityId)
        if (next.length !== ingredients.length) {
          ingredients = next
          menus = menus.map((menu) => menu.recipe.some((line) => line.ingredientId === change.entityId)
            ? { ...menu, recipe: menu.recipe.filter((line) => line.ingredientId !== change.entityId) }
            : menu)
          changed = true
        }
      } else {
        const previous = ingredients.find((item) => item.id === change.entityId)
        const parsed = ingredientFromPayload(change.payload ?? {}, previous)
        if (!parsed) { conflict(change, 'payload bahan tidak valid', localVersion); continue }
        ingredients = previous ? ingredients.map((item) => item.id === parsed.id ? parsed : item) : [...ingredients, parsed]
        changed = true
      }
    } else if (change.entity === 'menu_recipe') {
      const [menuId, ingredientId] = change.entityId.split(':')
      if (!menuId || !ingredientId) { conflict(change, 'ID resep tidak valid', localVersion); continue }
      const qty = change.op === 'delete' ? 0 : num(change.payload?.qty)
      const existsMenu = menus.some((item) => item.id === menuId)
      if (!existsMenu) { conflict(change, 'menu resep belum ada di perangkat', localVersion); continue }
      menus = menus.map((menu) => {
        if (menu.id !== menuId) return menu
        const others = menu.recipe.filter((line) => line.ingredientId !== ingredientId)
        return qty > 0 ? { ...menu, recipe: [...others, { ingredientId, qty }] } : { ...menu, recipe: others }
      })
      changed = true
    } else {
      if (change.op === 'delete') { conflict(change, 'pengaturan outlet tidak boleh dihapus dari cloud', localVersion); continue }
      const payload = change.payload ?? {}
      const fontSizes = ['compact', 'normal', 'large'] as const
      const fontSize = fontSizes.find((value) => value === str(payload.font_size)) ?? settings.printer.fontSize
      const printer = {
        ...settings.printer,
        paperWidth: num(payload.paper_width) === 80 ? 80 as const : 58 as const,
        headerAlign: str(payload.header_align) === 'center' ? 'center' as const : 'left' as const,
        footerAlign: str(payload.footer_align) === 'center' ? 'center' as const : 'left' as const,
        fontSize,
        showOrderType: bool(payload.show_order_type, settings.printer.showOrderType),
        showPaymentDetail: bool(payload.show_payment_detail, settings.printer.showPaymentDetail),
        copies: Math.min(3, Math.max(1, Math.trunc(num(payload.copies) || settings.printer.copies))),
      }
      settings = {
        ...settings,
        businessName: str(payload.business_name) || settings.businessName,
        outletName: str(payload.outlet_name) || settings.outletName,
        receiptFooter: str(payload.receipt_footer) || settings.receiptFooter,
        printer,
      }
      changed = true
    }

    applied += 1
    appliedVersions[key] = change.rowVersion
  }

  return {
    store: changed ? { ...store, categories, menus, ingredients, settings } : store,
    appliedVersions,
    applied,
    skipped,
    conflicts,
  }
}

/* -------------------------------------------------------------------------- */
/* Jaringan                                                                   */
/* -------------------------------------------------------------------------- */

function resolveFetch(deps: SyncDeps = {}): FetchLike {
  const candidate = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
  if (!candidate) throw new Error('Runtime ini tidak menyediakan fetch untuk sinkronisasi.')
  return candidate
}

async function activeSession(config: CloudBackupConfig, session: CloudSession | null, deps: SyncDeps): Promise<CloudSession> {
  if (!session) throw new Error('Belum masuk ke Supabase. Buka Backup → Backup cloud untuk menyambungkan akun pemilik.')
  const nowMs = (deps.now?.() ?? new Date()).getTime()
  if (session.expiresAt - 60_000 > nowMs) return session
  const refreshed = await refreshCloudSession(config, session, deps)
  await saveCloudSession(refreshed)
  return refreshed
}

async function callRpc<T>(
  config: CloudBackupConfig,
  session: CloudSession,
  rpc: 'pull_changes' | 'apply_sale',
  body: Record<string, unknown>,
  deps: SyncDeps,
): Promise<T> {
  const fetchImpl = resolveFetch(deps)
  const url = `${config.projectUrl.replace(/\/+$/, '')}/rest/v1/rpc/${rpc}`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new Error(`Tidak bisa menghubungi ${rpc}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const text = await response.text()
  if (!response.ok) {
    let detail = text.slice(0, 200)
    try {
      const parsed = JSON.parse(text) as { message?: string; details?: string; hint?: string }
      detail = parsed.message ?? detail
    } catch { /* respons bukan JSON; pakai potongan teks */ }
    throw new Error(`${rpc} ditolak (HTTP ${response.status}): ${detail}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

export type PullPage = {
  changes: SyncChange[]
  nextSeq: number
  hasMore: boolean
}

function parseChange(raw: Record<string, unknown>): SyncChange | null {
  const seq = Number(raw.seq)
  if (!Number.isFinite(seq)) return null
  const entity = str(raw.entity) as SyncEntity
  return {
    seq,
    entity,
    entityId: str(raw.entity_id),
    op: str(raw.op) === 'delete' ? 'delete' : 'upsert',
    rowVersion: Number(raw.row_version) || 1,
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload as Record<string, unknown> : null,
    changedAt: str(raw.changed_at),
    deviceId: str(raw.device_id) || null,
  }
}

export async function pullChangesPage(
  config: CloudBackupConfig,
  session: CloudSession | null,
  sinceSeq: number,
  options: SyncDeps & { limit?: number; pageLimit?: number } = {},
): Promise<PullPage> {
  const active = await activeSession(config, session, options)
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? options.pageLimit ?? DEFAULT_PAGE_LIMIT)))
  const result = await callRpc<{ changes?: Record<string, unknown>[]; next_seq?: number; has_more?: boolean }>(
    config,
    active,
    'pull_changes',
    { p_outlet: config.outletId, p_since_seq: Math.max(0, Math.trunc(sinceSeq)), p_limit: limit },
    options,
  )
  const changes = (result?.changes ?? []).map(parseChange).filter((change): change is SyncChange => change !== null)
  return {
    changes,
    nextSeq: Number(result?.next_seq) || sinceSeq,
    hasMore: Boolean(result?.has_more),
  }
}

export type PullAllResult = {
  changes: SyncChange[]
  nextSeq: number
  pages: number
}

/** Ambil semua halaman sampai `has_more=false` (dibatasi MAX_PAGES). */
export async function pullAllPages(
  config: CloudBackupConfig,
  session: CloudSession | null,
  sinceSeq: number,
  options: SyncDeps & { pageLimit?: number; maxPages?: number } = {},
): Promise<PullAllResult> {
  const maxPages = Math.max(1, Math.trunc(options.maxPages ?? MAX_PAGES))
  let cursor = Math.max(0, Math.trunc(sinceSeq))
  const changes: SyncChange[] = []
  let pages = 0
  while (pages < maxPages) {
    const page = await pullChangesPage(config, session, cursor, options)
    pages += 1
    changes.push(...page.changes)
    cursor = Math.max(cursor, page.nextSeq)
    if (!page.hasMore) return { changes, nextSeq: cursor, pages }
    if (page.changes.length === 0) return { changes, nextSeq: cursor, pages }
  }
  return { changes, nextSeq: cursor, pages }
}

export function saleOutboxPayload(store: PosStore, transaction: Transaction, deviceId?: string): Record<string, unknown> {
  return {
    outlet_id: store.sync.outletId,
    device_id: deviceId ?? store.sync.deviceId,
    transaction: {
      id: transaction.id,
      number: transaction.number,
      created_at: transaction.createdAt,
      order_type: transaction.orderType,
      payment_method: transaction.paymentMethod,
      subtotal: transaction.subtotal,
      paid_amount: transaction.paidAmount,
      change_amount: transaction.change,
      status: transaction.status,
      note: transaction.note,
      status_reason: transaction.statusReason,
      status_changed_at: transaction.statusChangedAt,
      shift_id: transaction.shiftId,
    },
    items: transaction.items.map((item, index) => ({
      id: `${transaction.id}-item-${index + 1}`,
      menu_id: item.id,
      name: item.name,
      category: item.category,
      price: item.price,
      qty: item.qty,
      emoji: item.emoji,
      image_url: item.imageUrl,
    })),
  }
}

/** Tambahkan penjualan ke outbox (idempoten per ID transaksi). */
export async function enqueueSale(store: PosStore, transaction: Transaction): Promise<OutboxEntry[]> {
  const entries = await readOutbox()
  const id = `sale:${transaction.id}`
  if (entries.some((entry) => entry.id === id)) return entries
  const entry: OutboxEntry = {
    id,
    kind: 'sale',
    outletId: store.sync.outletId,
    createdAt: new Date().toISOString(),
    payload: saleOutboxPayload(store, transaction),
    attempts: 0,
  }
  const next = [...entries, entry]
  await writeOutbox(next)
  return next
}

export type PushResult = { pushed: number; remaining: number; error?: string }

/** Kirim outbox lewat RPC atomik; sukses/duplikat dihapus dari antrean. */
export async function pushOutbox(
  config: CloudBackupConfig,
  session: CloudSession | null,
  options: SyncDeps = {},
): Promise<PushResult> {
  const entries = await readOutbox()
  if (entries.length === 0) return { pushed: 0, remaining: 0 }
  const active = await activeSession(config, session, options)
  const remaining: OutboxEntry[] = []
  let pushed = 0
  let failure: string | undefined

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    try {
      const result = await callRpc<{ applied?: boolean; duplicate?: boolean }>(config, active, 'apply_sale', { p_payload: entry.payload }, options)
      if (result && (result.applied === true || result.duplicate === true)) pushed += 1
      else remaining.push({ ...entry, attempts: entry.attempts + 1, lastError: 'RPC tidak menerapkan penjualan' })
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
      remaining.push({ ...entry, attempts: entry.attempts + 1, lastError: failure })
      // Berhenti pada kegagalan jaringan/auth: sisa antrean dikirim pada percobaan berikutnya.
      if (/HTTP 401|HTTP 403|Tidak bisa menghubungi/i.test(failure)) {
        remaining.push(...entries.slice(index + 1))
        break
      }
    }
  }

  await writeOutbox(remaining)
  return { pushed, remaining: remaining.length, error: failure }
}

/** Kirim antrean tanpa melempar error; dipakai setelah penjualan baru. */
export async function pushOutboxQuietly(
  deps: SyncDeps & { config?: CloudBackupConfig | null; session?: CloudSession | null } = {},
): Promise<PushResult> {
  const config = deps.config === undefined ? await loadCloudConfig() : deps.config
  const pending = (await readOutbox()).length
  if (!config?.enabled) return { pushed: 0, remaining: pending }
  const session = deps.session === undefined ? await loadCloudSession() : deps.session
  if (!session) return { pushed: 0, remaining: pending }
  try {
    const result = await pushOutbox(config, session, deps)
    publishSyncStatus({ pending: result.remaining, state: result.error ? 'error' : 'ok', lastError: result.error })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publishSyncStatus({ state: 'error', lastError: message })
    return { pushed: 0, remaining: (await readOutbox()).length, error: message }
  }
}

/* -------------------------------------------------------------------------- */
/* Orkestrasi                                                                 */
/* -------------------------------------------------------------------------- */

export type SyncNowOptions = SyncDeps & {
  store: PosStore
  onStore?: (store: PosStore) => Promise<void> | void
  config?: CloudBackupConfig | null
  session?: CloudSession | null
  pageLimit?: number
  maxPages?: number
  /** Entitas dengan perubahan lokal tertunda yang tidak boleh ditimpa. */
  pendingEntities?: Iterable<string>
}

/**
 * Satu siklus sync: pull berhalaman → terapkan → simpan kursor → push outbox.
 * Tidak pernah melempar ke pemanggil; kegagalan hanya menghasilkan status error
 * dan store lokal tidak berubah.
 */
export async function syncNow(options: SyncNowOptions): Promise<SyncSummary> {
  const startedPullAt = (options.now?.() ?? new Date()).toISOString()
  const base: SyncSummary = { ok: false, changed: false, applied: 0, skippedChanges: 0, conflicts: [], nextSeq: 0, pending: status.pending }
  const config = options.config === undefined ? await loadCloudConfig() : options.config
  if (!config?.enabled) {
    publishSyncStatus({ state: 'disabled', pending: (await readOutbox()).length })
    return { ...base, skipped: 'disabled' }
  }
  const session = options.session === undefined ? await loadCloudSession() : options.session
  if (!session) {
    publishSyncStatus({ state: 'pending-setup', lastError: 'Masuk dengan akun pemilik Supabase untuk mengaktifkan sinkronisasi.' })
    return { ...base, skipped: 'no-session' }
  }

  const stateFile = await readSyncState()
  const outlet = outletStateFor(stateFile, config.outletId)
  publishSyncStatus({ state: 'pulling', lastError: undefined, lastSeq: outlet.lastSeq, pending: base.pending })

  try {
    const pulled = await pullAllPages(config, session, outlet.lastSeq, options)
    const applied = applyChanges(options.store, pulled.changes, {
      appliedVersions: outlet.appliedVersions,
      pendingEntities: options.pendingEntities,
      now: options.now?.(),
    })
    const nextOutletState: OutletSyncState = {
      lastSeq: Math.max(outlet.lastSeq, pulled.nextSeq),
      lastPullAt: startedPullAt,
      appliedVersions: applied.appliedVersions,
    }
    await saveOutletState(config.outletId, nextOutletState)
    await appendConflicts(applied.conflicts)
    if (applied.store !== options.store && options.onStore) await options.onStore(applied.store)

    publishSyncStatus({ state: 'pushing', lastPullAt: startedPullAt, lastSeq: nextOutletState.lastSeq })
    const push = await pushOutbox(config, session, options)
    const summary: SyncSummary = {
      ok: !push.error,
      changed: applied.store !== options.store,
      applied: applied.applied,
      skippedChanges: applied.skipped,
      conflicts: applied.conflicts,
      nextSeq: nextOutletState.lastSeq,
      pending: push.remaining,
      error: push.error,
    }
    publishSyncStatus({
      state: push.error ? 'error' : 'ok',
      lastPullAt: startedPullAt,
      lastSeq: nextOutletState.lastSeq,
      lastError: push.error,
      pending: push.remaining,
      conflicts: status.conflicts + applied.conflicts.length,
    })
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publishSyncStatus({ state: 'error', lastError: message, lastPullAt: startedPullAt })
    return { ...base, nextSeq: outlet.lastSeq, error: message }
  }
}

/* -------------------------------------------------------------------------- */
/* Realtime sebagai pemicu + fallback polling                                 */
/* -------------------------------------------------------------------------- */

export type SocketLike = {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
}

export type RealtimeBridgeOptions = SyncDeps & {
  config: CloudBackupConfig
  session: CloudSession
  onChange: () => void
  pollIntervalMs?: number
  debounceMs?: number
  heartbeatMs?: number
  webSocketFactory?: (url: string) => SocketLike | null
  onStatus?: (realtime: SyncStatus['realtime']) => void
}

export type RealtimeBridge = {
  stop: () => void
  getState: () => SyncStatus['realtime']
  /** Dipakai uji: picu satu sinyal perubahan tanpa websocket. */
  signal: () => void
}

/**
 * Realtime hanya pemicu: pesan apa pun di channel outlet di-debounce lalu
 * memanggil `onChange`. Polling tetap berjalan sebagai fallback sehingga
 * perubahan tidak pernah bergantung pada websocket.
 */
export function startRealtimeBridge(options: RealtimeBridgeOptions): RealtimeBridge {
  const pollMs = Math.max(1_000, options.pollIntervalMs ?? DEFAULT_POLL_MS)
  const debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
  const heartbeatMs = Math.max(5_000, options.heartbeatMs ?? 25_000)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let state: SyncStatus['realtime'] = 'off'
  let socket: SocketLike | null = null
  let stopped = false
  let ref = 0

  const setState = (next: SyncStatus['realtime']) => {
    if (state === next) return
    state = next
    publishSyncStatus({ realtime: next })
    options.onStatus?.(next)
  }

  const signal = () => {
    if (stopped) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (!stopped) options.onChange()
    }, debounceMs)
  }

  // Polling selalu aktif: fallback saat websocket mati maupun saat pesan realtime terlewat.
  pollTimer = setInterval(() => { if (!stopped) options.onChange() }, pollMs)

  const open = () => {
    if (stopped) return
    const factory = options.webSocketFactory
      ?? (typeof WebSocket === 'function' ? (url: string) => new WebSocket(url) as unknown as SocketLike : undefined)
    if (!factory) { setState('polling'); return }
    let created: SocketLike | null = null
    try {
      created = factory(`${options.config.projectUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/realtime/v1/websocket?apikey=${encodeURIComponent(options.config.anonKey)}&vsn=1.0.0`)
    } catch {
      setState('polling')
      return
    }
    if (!created) { setState('polling'); return }
    socket = created
    created.onopen = () => {
      if (stopped) return
      ref += 1
      const topic = `realtime:outlet:${options.config.outletId}`
      created?.send(JSON.stringify({
        topic,
        event: 'phx_join',
        payload: {
          config: {
            postgres_changes: [{
              event: '*',
              schema: 'public',
              table: 'outlet_changes',
              filter: `outlet_id=eq.${options.config.outletId}`,
            }],
          },
        },
        ref: String(ref),
      }))
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = setInterval(() => {
        if (stopped) return
        try {
          created?.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }))
        } catch { /* koneksi sudah tertutup; fallback polling tetap berjalan */ }
      }, heartbeatMs)
      setState('connected')
      // Setelah tersambung, tarik perubahan yang mungkin terlewat saat offline.
      options.onChange()
    }
    created.onmessage = (event) => {
      if (stopped) return
      let parsed: { event?: string } | null = null
      try {
        parsed = typeof event.data === 'string' ? JSON.parse(event.data) as { event?: string } : null
      } catch { parsed = null }
      if (!parsed) return
      if (parsed.event === 'postgres_changes' || parsed.event === 'INSERT' || parsed.event === 'UPDATE' || parsed.event === 'DELETE') signal()
    }
    created.onerror = () => {
      if (stopped) return
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      setState('polling')
    }
    created.onclose = () => {
      if (stopped) return
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      setState('polling')
    }
  }

  open()

  return {
    stop: () => {
      stopped = true
      if (debounceTimer) clearTimeout(debounceTimer)
      if (pollTimer) clearInterval(pollTimer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      try { socket?.close() } catch { /* socket sudah tertutup */ }
      socket = null
      setState('off')
    },
    getState: () => state,
    signal,
  }
}

/** Berguna untuk mount awal: siapkan backup harian dulu sebelum pull pertama. */
export async function prepareSync(store: PosStore): Promise<void> {
  try {
    await ensureDailyBackup(store)
  } catch (error) {
    console.warn('Backup harian sebelum sync gagal', error)
  }
}
