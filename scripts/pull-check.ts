/**
 * Uji Fase 3 (pull bertahap + realtime pemicu + push penjualan) tanpa Supabase.
 *
 * Semua RPC memakai fetch tiruan; websocket memakai kelas palsu. Fokus:
 * paginasi, idempotensi pull berulang, tombstone, LWW, penolakan konflik,
 * fallback polling saat realtime mati, dan pull yang gagal tidak merusak data.
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  clear() { this.map.clear() }
  getItem(key: string) { return this.map.get(key) ?? null }
  key(index: number) { return [...this.map.keys()][index] ?? null }
  removeItem(key: string) { this.map.delete(key) }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })

const storage = await import('../src/lib/storage')
await storage.initStorage()

const { inspectBackupValue } = await import('../src/lib/backup')
const { normalizeStore } = await import('../src/lib/schema')
const sync = await import('../src/lib/sync-client')
const { SCHEMA_VERSION } = await import('../src/domain/pos')

let checks = 0
let failures = 0
function check(name: string, condition: boolean, detail = '') {
  checks += 1
  if (condition) console.log(`PASS ${name}`)
  else { failures += 1; console.error(`FAIL ${name} ${detail}`) }
}

const fixture = inspectBackupValue(JSON.parse(readFileSync(join(process.cwd(), 'scripts/fixtures/supabase-seed.json'), 'utf8')) as unknown)
if (!fixture.ok) {
  console.error(`Fixture tidak valid: ${fixture.error}`)
  process.exit(1)
}

const outletId = '471d3f1c-1ad0-4f88-a35c-7f9f6e968926'
const baseStore = { ...normalizeStore(fixture.store), sync: { ...normalizeStore(fixture.store).sync, outletId, deviceId: 'device-kasir-uji' } }

const config = {
  enabled: true,
  projectUrl: 'https://contoh-uji.supabase.co',
  anonKey: 'anon-key-uji',
  outletId,
  bucket: 'pos-backups',
  key: null,
  updatedAt: '2026-10-27T08:00:00.000Z',
}
const session = {
  accessToken: 'access-uji',
  refreshToken: 'refresh-uji',
  expiresAt: Date.now() + 3_600_000,
  email: 'owner@example.test',
  userId: 'owner-user-uji',
}

type Call = { url: string; rpc: string; body: Record<string, unknown> }
let calls: Call[] = []
let applySaleResponses: (() => Response)[] = []
let pullDataset: sync.SyncChange[] = []
let pullFailure: Response | null = null

function change(partial: Partial<sync.SyncChange> & { seq: number; entity: sync.SyncEntity; entityId: string }): sync.SyncChange {
  return {
    op: 'upsert',
    rowVersion: 1,
    payload: null,
    changedAt: `2026-10-27T09:0${partial.seq}:00.000Z`,
    deviceId: 'device-server',
    ...partial,
  }
}

function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
  const rpc = input.split('/rpc/')[1] ?? ''
  calls.push({ url: input, rpc, body })

  if (rpc === 'pull_changes') {
    if (pullFailure) return Promise.resolve(pullFailure)
    const since = Number(body.p_since_seq ?? 0)
    const limit = Number(body.p_limit ?? 200)
    const pending = pullDataset.filter((item) => item.seq > since)
    const page = pending.slice(0, limit)
    const nextSeq = page.length > 0 ? page[page.length - 1]!.seq : since
    const hasMore = pending.length > page.length
    // PostgREST mengembalikan kolom snake_case, jadi uji memakai bentuk yang sama.
    const rows = page.map((item) => ({
      seq: item.seq,
      outlet_id: outletId,
      entity: item.entity,
      entity_id: item.entityId,
      op: item.op,
      row_version: item.rowVersion,
      payload: item.payload,
      device_id: item.deviceId,
      changed_at: item.changedAt,
    }))
    return Promise.resolve(new Response(JSON.stringify({ changes: rows, next_seq: nextSeq, has_more: hasMore }), { status: 200 }))
  }

  if (rpc === 'apply_sale') {
    const next = applySaleResponses.shift()
    return Promise.resolve(next ? next() : new Response(JSON.stringify({ applied: true, duplicate: false }), { status: 200 }))
  }

  return Promise.resolve(new Response('{}', { status: 200 }))
}

function reset(dataset: sync.SyncChange[] = [], failure: Response | null = null) {
  calls = []
  applySaleResponses = []
  pullDataset = dataset
  pullFailure = failure
}

const deps = { fetchImpl: fakeFetch, now: () => new Date('2026-10-27T09:30:00.000Z') }

/* -------------------------------------------------------------------------- */
/* 1. Paginasi + kursor                                                       */
/* -------------------------------------------------------------------------- */

const dataset: sync.SyncChange[] = [
  change({ seq: 1, entity: 'category', entityId: 'kategori-baru', payload: { id: 'kategori-baru', name: 'Kategori Baru' } }),
  change({ seq: 2, entity: 'ingredient', entityId: 'bahan-baru', payload: { id: 'bahan-baru', name: 'Bahan Baru', unit: 'gram', cost_per_unit: 10, purchase_unit: 'pack', purchase_price: 10000, usage_per_purchase_unit: 1000, min_stock: 5 } }),
  change({ seq: 3, entity: 'menu', entityId: 'menu-baru', payload: { id: 'menu-baru', name: 'Menu Baru', category_id: 'kategori-baru', price: 15000, emoji: '🍗', active: true } }),
  change({ seq: 4, entity: 'menu_recipe', entityId: 'menu-baru:bahan-baru', payload: { menu_id: 'menu-baru', ingredient_id: 'bahan-baru', qty: 2 } }),
  change({ seq: 5, entity: 'outlet_settings', entityId: outletId, payload: { outlet_id: outletId, business_name: 'SABANA BARU', outlet_name: 'Outlet Uji', receipt_footer: 'Makasih', paper_width: 80, header_align: 'center', footer_align: 'center', font_size: 'large', show_order_type: false, show_payment_detail: true, copies: 2 } }),
]

reset(dataset)
let saved: typeof baseStore | null = null
const first = await sync.syncNow({
  store: baseStore,
  onStore: (next) => { saved = next },
  config,
  session,
  pageLimit: 2,
  ...deps,
})

check('pull multi-halaman berhenti saat has_more=false', saved !== null && first.ok && first.applied === 5, JSON.stringify(first))
check('pull memakai halaman berukuran limit dan berurutan', calls.filter((call) => call.rpc === 'pull_changes').length === 3, String(calls.length))
const pullBodies = calls.filter((call) => call.rpc === 'pull_changes').map((call) => Number(call.body.p_since_seq))
check('halaman berikutnya memakai since_seq maju', pullBodies.join(',') === '0,2,4', pullBodies.join(','))
check('kursor seq tersimpan per outlet', (await sync.readSyncState()).outlets[outletId]?.lastSeq === 5, JSON.stringify((await sync.readSyncState()).outlets))
check('kategori remote masuk ke katalog lokal', saved?.categories.some((item) => item.id === 'kategori-baru') === true)
check('menu remote memakai nama kategori hasil pull', saved?.menus.find((item) => item.id === 'menu-baru')?.category === 'Kategori Baru')
check('resep remote menempel ke menu yang sama', saved?.menus.find((item) => item.id === 'menu-baru')?.recipe.some((line) => line.ingredientId === 'bahan-baru' && line.qty === 2) === true)
check('pengaturan outlet mengikuti cloud (lebar kertas & salinan)', saved?.settings.printer.paperWidth === 80 && saved?.settings.printer.copies === 2)
check('deviceName printer lokal tidak ikut ditimpa', saved?.settings.printer.deviceName === baseStore.settings.printer.deviceName)
check('ledger lokal tidak tersentuh pull', saved?.transactions.length === baseStore.transactions.length)

/* -------------------------------------------------------------------------- */
/* 2. Idempotensi pull berulang                                               */
/* -------------------------------------------------------------------------- */

reset([])
const second = await sync.syncNow({ store: saved ?? baseStore, onStore: () => { throw new Error('store tidak boleh berubah') }, config, session, pageLimit: 2, ...deps })
check('pull ulang pada kursor akhir tidak mengubah store', second.changed === false && second.applied === 0, JSON.stringify(second))

// Server mengirim ulang perubahan yang sama (mis. karena kursor direset manual).
const appliedVersions = (await sync.readSyncState()).outlets[outletId]?.appliedVersions ?? {}
await sync.writeSyncState({ version: 1, outlets: { [outletId]: { lastSeq: 0, lastPullAt: '', appliedVersions } } })
reset(dataset)
const replay = await sync.syncNow({ store: saved ?? baseStore, onStore: () => { throw new Error('store tidak boleh berubah') }, config, session, pageLimit: 5, ...deps })
check('replay perubahan yang sudah diterapkan dilewati (idempoten)', replay.changed === false && replay.applied === 0 && replay.skippedChanges === 5, JSON.stringify(replay))

/* -------------------------------------------------------------------------- */
/* 3. Tombstone                                                               */
/* -------------------------------------------------------------------------- */

const tombstoneDataset: sync.SyncChange[] = [
  change({ seq: 10, entity: 'menu', entityId: 'menu-baru', op: 'delete', rowVersion: 2, payload: { id: 'menu-baru', deleted_at: '2026-10-27T09:10:00.000Z' } }),
  change({ seq: 11, entity: 'ingredient', entityId: 'bahan-baru', op: 'delete', rowVersion: 2, payload: { id: 'bahan-baru', deleted_at: '2026-10-27T09:11:00.000Z' } }),
  change({ seq: 12, entity: 'category', entityId: 'kategori-baru', op: 'delete', rowVersion: 2, payload: { id: 'kategori-baru', deleted_at: '2026-10-27T09:12:00.000Z' } }),
]
reset(tombstoneDataset)
let afterTombstone: typeof baseStore | null = null
const tombstone = await sync.syncNow({ store: saved ?? baseStore, onStore: (next) => { afterTombstone = next }, config, session, pageLimit: 10, ...deps })
check('tombstone diterapkan untuk menu/bahan/kategori', tombstone.applied === 3
  && afterTombstone?.menus.some((item) => item.id === 'menu-baru') === false
  && afterTombstone?.ingredients.some((item) => item.id === 'bahan-baru') === false
  && afterTombstone?.categories.some((item) => item.id === 'kategori-baru') === false, JSON.stringify(tombstone))

/* -------------------------------------------------------------------------- */
/* 4. Konflik: LWW + penolakan                                                */
/* -------------------------------------------------------------------------- */

const lwwStore = afterTombstone ?? baseStore
reset([
  change({ seq: 20, entity: 'menu', entityId: 'dada', rowVersion: 7, payload: { id: 'dada', name: 'Ayam Dada Baru', category_id: 'paket', price: 20000, active: true } }),
])
let lwwApplied: typeof baseStore | null = null
const lww = await sync.syncNow({ store: lwwStore, onStore: (next) => { lwwApplied = next }, config, session, pageLimit: 10, ...deps })
check('perubahan baru menang (LWW) dan diterapkan', lww.applied === 1 && lwwApplied?.menus.find((item) => item.id === 'dada')?.name === 'Ayam Dada Baru', JSON.stringify(lww))

reset([
  change({ seq: 21, entity: 'menu', entityId: 'dada', rowVersion: 6, payload: { id: 'dada', name: 'Versi Lama', category_id: 'paket', price: 1000, active: true } }),
])
const stale = await sync.syncNow({ store: lwwApplied ?? lwwStore, onStore: () => { throw new Error('versi lama tidak boleh menimpa') }, config, session, pageLimit: 10, ...deps })
check('versi remote yang lebih tua dilewati', stale.changed === false && stale.applied === 0 && stale.skippedChanges === 1, JSON.stringify(stale))

reset([
  change({ seq: 22, entity: 'menu', entityId: 'dada', rowVersion: 9, payload: { id: 'dada', name: 'Menimpa Lokal', category_id: 'paket', price: 99999, active: true } }),
  change({ seq: 23, entity: 'transaction', entityId: 'tx-palsu' as sync.SyncEntity, rowVersion: 1, payload: { id: 'tx-palsu' } }),
])
const conflictRun = await sync.syncNow({
  store: lwwApplied ?? lwwStore,
  onStore: (next) => { lwwApplied = next },
  config,
  session,
  pageLimit: 10,
  pendingEntities: ['menu:dada'],
  ...deps,
})
const storedConflicts = await sync.readConflicts()
check('baris dengan perubahan lokal tertunda ditolak + dicatat', conflictRun.conflicts.some((item) => item.entity === 'menu' && item.reason.includes('perubahan lokal')))
check('entitas ledger (transaksi) tidak pernah ditimpa pull', conflictRun.conflicts.some((item) => item.reason.includes('tidak didukung')))
check('konflik tersimpan untuk dibaca pemilik', storedConflicts.length >= 2, String(storedConflicts.length))
check('nama menu lokal tetap utuh setelah konflik', lwwApplied?.menus.find((item) => item.id === 'dada')?.name === 'Ayam Dada Baru')
check('kursor tetap maju melewati perubahan yang ditolak', (await sync.readSyncState()).outlets[outletId]?.lastSeq === 23, JSON.stringify((await sync.readSyncState()).outlets[outletId]))

/* -------------------------------------------------------------------------- */
/* 5. Pull gagal tidak merusak data lokal                                     */
/* -------------------------------------------------------------------------- */

const before = JSON.stringify(lwwApplied)
const cursorBefore = (await sync.readSyncState()).outlets[outletId]?.lastSeq
reset([], new Response(JSON.stringify({ message: 'server sedang sibuk' }), { status: 500 }))
const failed = await sync.syncNow({ store: lwwApplied ?? baseStore, onStore: () => { throw new Error('store tidak boleh berubah saat pull gagal') }, config, session, pageLimit: 10, ...deps })
check('pull gagal menghasilkan status error yang bisa dibaca', failed.ok === false && (failed.error ?? '').length > 0, JSON.stringify(failed.error))
check('pull gagal tidak mengubah store lokal', JSON.stringify(lwwApplied) === before)
check('pull gagal tidak memindahkan kursor', (await sync.readSyncState()).outlets[outletId]?.lastSeq === cursorBefore)
check('status sync menandai kegagalan', sync.getSyncStatus().state === 'error', JSON.stringify(sync.getSyncStatus()))

/* -------------------------------------------------------------------------- */
/* 6. Outbox penjualan + RPC idempoten                                        */
/* -------------------------------------------------------------------------- */

const saleStore = lwwApplied ?? baseStore
const transaction = {
  id: 'tx-outbox-1',
  number: 'POS-999',
  createdAt: '2026-10-27T10:05:00.000Z',
  orderType: 'Takeaway' as const,
  paymentMethod: 'Cash' as const,
  items: [{ id: 'dada', name: 'Ayam Dada', category: 'Paket', price: 20000, qty: 2, emoji: '🍗' }],
  subtotal: 40000,
  paidAmount: 50000,
  change: 10000,
  status: 'completed' as const,
  shiftId: 'shift-uji',
}
await sync.writeOutbox([])
const queued = await sync.enqueueSale(saleStore, transaction)
check('penjualan masuk antrean lokal', queued.length === 1 && queued[0]?.id === 'sale:tx-outbox-1', JSON.stringify(queued))
const payload = queued[0]?.payload as { outlet_id: string; transaction: { id: string; subtotal: number }; items: { id: string; menu_id: string; qty: number }[] }
check('payload RPC memuat outlet + transaksi + item', payload.outlet_id === outletId && payload.transaction.id === 'tx-outbox-1' && payload.items[0]?.menu_id === 'dada' && payload.items[0]?.qty === 2, JSON.stringify(payload).slice(0, 200))
const duplicateQueue = await sync.enqueueSale(saleStore, transaction)
check('antrean tidak menggandakan penjualan yang sama', duplicateQueue.length === 1)

reset()
const pushed = await sync.pushOutbox(config, session, deps)
check('push sukses mengosongkan antrean', pushed.pushed === 1 && pushed.remaining === 0, JSON.stringify(pushed))
check('push memakai RPC apply_sale dengan payload penuh', calls[0]?.rpc === 'apply_sale' && Boolean((calls[0]?.body.p_payload as Record<string, unknown>)?.transaction), JSON.stringify(calls[0]?.body).slice(0, 160))
check('antrean kosong tersimpan di penyimpanan lokal', (await sync.readOutbox()).length === 0)

await sync.enqueueSale(saleStore, { ...transaction, id: 'tx-outbox-2', number: 'POS-1000' })
reset()
applySaleResponses = [() => new Response(JSON.stringify({ applied: false, duplicate: true }), { status: 200 })]
const duplicatePush = await sync.pushOutbox(config, session, deps)
check('duplikat dari server dianggap terkirim (idempoten)', duplicatePush.pushed === 1 && duplicatePush.remaining === 0, JSON.stringify(duplicatePush))

await sync.enqueueSale(saleStore, { ...transaction, id: 'tx-outbox-3', number: 'POS-1001' })
reset()
applySaleResponses = [() => new Response(JSON.stringify({ message: 'constraint gagal' }), { status: 400 })]
const failedPush = await sync.pushOutbox(config, session, deps)
const kept = await sync.readOutbox()
check('push gagal menyimpan ulang entri dengan percobaan tercatat', failedPush.remaining === 1 && kept[0]?.attempts === 1 && (kept[0]?.lastError ?? '').includes('400'), JSON.stringify(kept))

await sync.writeOutbox([])
await sync.enqueueSale(saleStore, { ...transaction, id: 'tx-outbox-4', number: 'POS-1002' })
await sync.enqueueSale(saleStore, { ...transaction, id: 'tx-outbox-5', number: 'POS-1003' })
reset()
applySaleResponses = [() => new Response(JSON.stringify({ message: 'JWT expired' }), { status: 401 })]
const authFailPush = await sync.pushOutbox(config, session, deps)
check('kegagalan auth menyisakan seluruh antrean', authFailPush.remaining === 2 && authFailPush.error?.includes('401') === true, JSON.stringify(authFailPush))

const quiet = await sync.pushOutboxQuietly({ config: { ...config, enabled: false }, session, ...deps })
check('push quiet tanpa konfigurasi tidak melempar dan tidak memanggil jaringan', quiet.pushed === 0 && calls.length === 1, JSON.stringify(quiet))
await sync.writeOutbox([])
await sync.hydrateSyncStatus()
check('status awal setelah antrean bersih = antrean kosong', sync.getSyncStatus().pending === 0, JSON.stringify(sync.getSyncStatus()))

/* -------------------------------------------------------------------------- */
/* 7. Realtime pemicu + fallback polling                                      */
/* -------------------------------------------------------------------------- */

type SocketLike = sync.SocketLike
class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  closed = false
  constructor(public url: string) { FakeSocket.instances.push(this) }
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true }
}

let realtimeSignals = 0
let lastRealtimeState: sync.SyncStatus['realtime'] = 'off'
const bridge = sync.startRealtimeBridge({
  config,
  session,
  onChange: () => { realtimeSignals += 1 },
  debounceMs: 10,
  pollIntervalMs: 1_000,
  heartbeatMs: 10_000,
  webSocketFactory: (url) => new FakeSocket(url),
  onStatus: (state) => { lastRealtimeState = state },
})

const socket = FakeSocket.instances[0]
check('bridge membuka websocket ke endpoint Realtime', Boolean(socket) && socket?.url.includes('/realtime/v1/websocket?apikey='), socket?.url)
socket?.onopen?.()
const joinMessage = socket?.sent[0] ?? ''
check('join channel memfilter outlet_changes per outlet', joinMessage.includes('postgres_changes') && joinMessage.includes(`outlet_id=eq.${outletId}`), joinMessage.slice(0, 200))
check('status realtime menjadi connected setelah join', lastRealtimeState === 'connected', lastRealtimeState)

const signalsBeforeMessage = realtimeSignals
socket?.onmessage?.({ data: JSON.stringify({ event: 'postgres_changes', payload: {} }) })
await new Promise((resolve) => setTimeout(resolve, 60))
check('pesan realtime memicu pull setelah debounce', realtimeSignals === signalsBeforeMessage + 1, `${signalsBeforeMessage} → ${realtimeSignals}`)

socket?.onmessage?.({ data: JSON.stringify({ event: 'postgres_changes', payload: {} }) })
socket?.onmessage?.({ data: JSON.stringify({ event: 'postgres_changes', payload: {} }) })
await new Promise((resolve) => setTimeout(resolve, 60))
check('beberapa pesan beruntun di-debounce menjadi satu pemicu', realtimeSignals === signalsBeforeMessage + 2, `${signalsBeforeMessage} → ${realtimeSignals}`)

socket?.onerror?.()
check('websocket mati → status berpindah ke polling', lastRealtimeState === 'polling', lastRealtimeState)
const signalsBeforePoll = realtimeSignals
await new Promise((resolve) => setTimeout(resolve, 1_150))
check('polling fallback tetap menarik perubahan', realtimeSignals > signalsBeforePoll, `${signalsBeforePoll} → ${realtimeSignals}`)

bridge.stop()
const signalsAfterStop = realtimeSignals
await new Promise((resolve) => setTimeout(resolve, 1_150))
check('stop menghentikan polling', realtimeSignals === signalsAfterStop && socket?.closed === true)

check('skema aplikasi tetap v8 (tidak ada migrasi state yang dipaksa)', SCHEMA_VERSION === 8, String(SCHEMA_VERSION))

if (failures > 0) {
  console.error(`\n${failures} dari ${checks} pemeriksaan pull/sync gagal`)
  process.exit(1)
}
console.log(`\nSemua ${checks} pemeriksaan pull/sync lolos (mock fetch + websocket palsu, tanpa Supabase nyata)`)
