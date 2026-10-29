/**
 * Uji wrapper storage dengan IndexedDB tiruan (fake-indexeddb).
 * Fokus: migrasi localStorage sekali, tidak menimpa data IndexedDB,
 * dan kegagalan tulis tidak ditelan.
 */
import 'fake-indexeddb/auto'

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
const backup = await import('../src/lib/backup')
const persistence = await import('../src/lib/persistence')
const online = await import('../src/lib/online')
const { normalizeStore } = await import('../src/lib/schema')
const { SCHEMA_VERSION } = await import('../src/domain/pos')

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`PASS ${name}`)
  else { failures += 1; console.error(`FAIL ${name} ${detail}`) }
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('sabana-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Gagal menghapus database uji'))
    request.onblocked = () => reject(new Error('Database uji diblokir'))
  })
}

const legacy = {
  schemaVersion: 5,
  transactions: [{
    id: 'legacy-tx', number: 'POS-900', createdAt: '2026-10-20T10:00:00.000Z',
    orderType: 'Takeaway', paymentMethod: 'Cash', items: [{ id: 'dada', name: 'Ayam Dada', category: 'Paket', price: 16000, qty: 1 }],
    subtotal: 16000, paidAmount: 20000, change: 4000, status: 'completed', shiftId: 'shift-legacy',
  }],
  cashMovements: [],
  shifts: [],
  heldOrders: [],
  preOrders: [],
  menus: [{ id: 'dada', name: 'Ayam Dada', category: 'Paket', price: 16000, emoji: '🍗', active: true, recipe: [] }],
  ingredients: [],
  categories: [{ id: 'paket', name: 'Paket' }],
  stockMovements: [],
  expenses: [],
  auditLog: [],
  settings: { businessName: 'Warung Uji', outletName: 'Outlet Uji', receiptFooter: 'Terima kasih', theme: 'light', printer: { deviceName: '', paperWidth: 58, autoPrint: false, headerAlign: 'left', footerAlign: 'left', fontSize: 'normal', showOrderType: true, showPaymentDetail: true, copies: 1 } },
  nextTransactionNumber: 901,
}

await deleteDatabase()
localStorage.setItem('sabana-pos-store-v1', JSON.stringify(legacy))

const first = await storage.initStorage()
check('backend utama adalah IndexedDB', first.backend === 'indexeddb', JSON.stringify(first))
check('state localStorage lama dimigrasikan', first.migrated)
const migrated = await storage.readJson<typeof legacy>('pos-store')
check('isi hasil migrasi sama dengan data lama', JSON.stringify(migrated) === JSON.stringify(legacy))
const marker = await storage.readJson<{ migratedAt: string; source: string }>('meta:legacy-migration')
check('migrasi ditandai setelah tulis sukses', Boolean(marker?.migratedAt) && marker?.source === 'sabana-pos-store-v1', JSON.stringify(marker))

const changed = { ...legacy, schemaVersion: 6, settings: { ...legacy.settings, outletName: 'Outlet Baru' } }
await storage.writeJson('pos-store', changed)
await storage.resetStorageForTests()
const second = await storage.initStorage()
const afterReopen = await storage.readJson<typeof changed>('pos-store')
check('IndexedDB yang sudah ada tidak ditimpa data lama', afterReopen?.settings.outletName === 'Outlet Baru', JSON.stringify(afterReopen?.settings))
check('migrasi kedua tidak dijalankan ulang', second.migrated === false, JSON.stringify(second))
check('membuka ulang tetap backend IndexedDB', second.backend === 'indexeddb', JSON.stringify(second))

const store = normalizeStore(changed)
const now = new Date('2026-10-26T12:00:00.000Z')
const dailyFirst = await backup.ensureDailyBackup(store, now)
check('backup harian dibuat saat belum ada backup', dailyFirst.created && dailyFirst.record?.reason === 'daily', JSON.stringify(dailyFirst.record?.reason))
const dailySecond = await backup.ensureDailyBackup(store, now)
check('backup harian tidak dibuat dua kali pada hari yang sama', dailySecond.created === false)
const readLatest = await backup.readLatestBackup()
check('backup terakhir tersimpan di IndexedDB', readLatest?.summary.outletName === 'Outlet Baru' && readLatest.schemaVersion === SCHEMA_VERSION, JSON.stringify(readLatest?.summary))
const closeBackup = await backup.createAndStoreBackup(store, 'before-shift-close', new Date('2026-10-26T21:00:00.000Z'))
const afterCloseBackup = await backup.readLatestBackup()
check('backup sebelum tutup shift menyimpan alasan dan snapshot', closeBackup.reason === 'before-shift-close' && afterCloseBackup?.reason === 'before-shift-close', JSON.stringify(afterCloseBackup?.reason))
const originalDocument = globalThis.document
const originalCreateObjectUrl = URL.createObjectURL
const originalRevokeObjectUrl = URL.revokeObjectURL
let downloadedFile = ''
const anchor = { href: '', download: '', click: () => { downloadedFile = anchor.download } }
Object.defineProperty(globalThis, 'document', { value: { createElement: () => anchor }, configurable: true })
Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:backup-uji', configurable: true })
Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
try {
  backup.downloadBackup(closeBackup)
} finally {
  Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true })
  Object.defineProperty(URL, 'createObjectURL', { value: originalCreateObjectUrl, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevokeObjectUrl, configurable: true })
}
check('backup bisa diunduh sebagai file JSON', downloadedFile.endsWith('.json') && downloadedFile.includes('before-shift-close'), downloadedFile)

// Regression: outlet online yang kosong tidak boleh diisi katalog contoh.
// Katalog seed memakai ID slug ("paket", "dada") yang bukan UUID sehingga
// upsert ke Supabase ditolak 22P02. Seed hanya untuk mode lokal.
const emptyOnline = normalizeStore({}, { seed: false })
storage.primeStorageCache('pos-store', emptyOnline)
const onlineLoaded = persistence.loadPosStore({ seed: false })
check('mode online tidak mengisi seed saat outlet kosong', onlineLoaded.menus.length === 0 && onlineLoaded.ingredients.length === 0 && onlineLoaded.categories.length === 0, `menu=${onlineLoaded.menus.length} bahan=${onlineLoaded.ingredients.length} kategori=${onlineLoaded.categories.length}`)
check('tidak ada ID slug seed pada outlet online', ![...onlineLoaded.menus, ...onlineLoaded.ingredients, ...onlineLoaded.categories].some((item) => ['paket', 'dada', 'teh', 'tepung-bumbu'].includes(item.id)))

// Regression: kategori turunan (mis. "Lainnya") pada mode online harus memakai
// UUID, karena kolom Supabase bertipe uuid dan upsert string ditolak 22P02.
const inferredOnline = normalizeStore({
  menus: [{ id: 'menu-uji', name: 'Menu Uji', category: 'Kategori Turunan', price: 1000, emoji: '🍽️', active: true, recipe: [] }],
  ingredients: [{ id: 'bahan-uji', name: 'Bahan Uji', category: 'Lainnya', unit: 'gram', costPerUnit: 1, purchaseUnit: 'pack', purchasePrice: 1000, usagePerPurchaseUnit: 1000, minStock: 0 }],
}, { seed: false })
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/
const inferredCategories = [...inferredOnline.categories, ...inferredOnline.ingredientCategories]
check('kategori turunan online memakai UUID', inferredCategories.every((category) => uuidPattern.test(category.id)), JSON.stringify(inferredCategories))
check('ID kategori turunan stabil antar-normalisasi', JSON.stringify(normalizeStore(inferredOnline, { seed: false }).categories) === JSON.stringify(inferredOnline.categories), JSON.stringify(normalizeStore(inferredOnline, { seed: false }).categories))
const localLoaded = persistence.loadPosStore()
check('mode lokal tetap mengisi katalog contoh', localLoaded.menus.length > 0 && localLoaded.ingredients.length > 0, `menu=${localLoaded.menus.length} bahan=${localLoaded.ingredients.length}`)
let onlineSavedMenus = -1
online.setOnlineDriver({ save: async (value) => { onlineSavedMenus = value.menus.length }, flush: async () => {} })
try {
  await persistence.savePosStore(emptyOnline)
} finally {
  online.setOnlineDriver(null)
}
check('simpan online tidak menambahkan katalog contoh', onlineSavedMenus === 0, String(onlineSavedMenus))

await storage.resetStorageForTests()
const originalConsoleError = console.error
console.error = () => {}
let writeFailed = false
try {
  await storage.writeJson('pos-store', changed)
} catch {
  writeFailed = true
} finally {
  await new Promise((resolve) => setTimeout(resolve, 10))
  console.error = originalConsoleError
}
check('kegagalan tulis ditolak, bukan ditelan', writeFailed)
check('pesan kuota penuh dapat dipahami pengguna', storage.describeStorageError(new DOMException('The quota has been exceeded.', 'QuotaExceededError')).includes('penuh'), storage.describeStorageError(new DOMException('The quota has been exceeded.', 'QuotaExceededError')))

if (failures > 0) {
  console.error(`${failures} pemeriksaan storage gagal`)
  process.exit(1)
}
console.log('Semua pemeriksaan storage lolos')
