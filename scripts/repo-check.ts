/**
 * check:repo — menguji lapisan repo Supabase tanpa project nyata.
 *
 * Cakupan:
 *   - load/save snapshot dengan gateway tiruan (tanpa jaringan),
 *   - seed awal diberi ID uuid dan referensi resep ikut diperbarui,
 *   - penyimpanan hanya mengirim baris yang berubah (idempoten),
 *   - penghapusan mengirim id yang hilang,
 *   - dokumen pendukung (kas, held, pre-order, beban, audit) ikut tersimpan,
 *   - numeric PostgREST berbentuk string tetap terbaca sebagai angka,
 *   - isolasi outlet,
 *   - driver online men-debounce perubahan dan menolak error jaringan,
 *   - akses outlet dibaca dari baris staf akun (bukan env) + pesan RLS jelas,
 *   - outlet online baru memakai store kosong tanpa katalog contoh,
 *   - outlet yang sudah dipakai tidak di-seed ulang.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { normalizeStore } from '../src/lib/schema'
import { createOnlineDriver } from '../src/lib/online'
import type { RepoGateway, Row, TableName } from '../src/lib/repo/gateway'
import { assignGeneratedIds, initialOnlineStore, loadStore, saveStore } from '../src/lib/repo/snapshot'
import { describeRepoError, readOutletAccess } from '../src/lib/repo/supabase-gateway'

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail: unknown = ''): void {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` :: ${detail}`}`)
}

const keyOf = (table: TableName, row: Row): string => {
  if (table === 'pos_documents') return `${String(row.outlet_id)}|${String(row.key)}`
  if (table === 'app_settings') return String(row.outlet_id)
  return String(row.id)
}

class FakeGateway implements RepoGateway {
  tables: Record<string, Row[]> = {}
  calls: { op: 'list' | 'upsert' | 'remove'; table: TableName; count: number }[] = []
  failOn: TableName | null = null

  async list(table: TableName, outletId: string): Promise<Row[]> {
    this.calls.push({ op: 'list', table, count: 0 })
    return (this.tables[table] ?? []).filter((row) => row.outlet_id === outletId).map((row) => ({ ...row }))
  }

  async upsert(table: TableName, rows: Row[]): Promise<void> {
    this.calls.push({ op: 'upsert', table, count: rows.length })
    if (this.failOn === table) throw new Error('jaringan mati')
    const list = (this.tables[table] ??= [])
    for (const row of rows) {
      const key = keyOf(table, row)
      const index = list.findIndex((entry) => keyOf(table, entry) === key)
      if (index >= 0) list[index] = { ...list[index], ...row }
      else list.push({ ...row })
    }
  }

  async remove(table: TableName, outletId: string, ids: string[]): Promise<void> {
    this.calls.push({ op: 'remove', table, count: ids.length })
    this.tables[table] = (this.tables[table] ?? []).filter((row) => !(row.outlet_id === outletId && ids.includes(String(row.id))))
  }

  count(op: 'list' | 'upsert' | 'remove', table: TableName): number {
    return this.calls.filter((call) => call.op === op && call.table === table).reduce((sum, call) => sum + call.count, 0)
  }

  resetCalls(): void {
    this.calls = []
  }
}

const OUTLET = '11111111-1111-4111-8111-111111111111'
const OTHER_OUTLET = '22222222-2222-4222-8222-222222222222'
const FIXED_NOW = '2026-10-28T12:00:00.000Z'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

const seeded = assignGeneratedIds(normalizeStore({}), nextId)
const expectedInserts = seeded.menus.length + seeded.ingredients.length + seeded.categories.length
  + seeded.ingredientCategories.length + seeded.stockMovements.length + seeded.shifts.length + seeded.transactions.length

const newOnlineStore = initialOnlineStore(null)
check('outlet online baru dimulai tanpa katalog contoh', newOnlineStore.menus.length === 0 && newOnlineStore.ingredients.length === 0 && newOnlineStore.categories.length === 0 && newOnlineStore.ingredientCategories.length === 0, `menu=${newOnlineStore.menus.length} bahan=${newOnlineStore.ingredients.length} kategori=${newOnlineStore.categories.length}`)
check('store awal online tidak memakai ID slug seed', ![...newOnlineStore.menus, ...newOnlineStore.ingredients, ...newOnlineStore.categories].some((item) => ['paket', 'dada', 'teh', 'tepung-bumbu'].includes(item.id)))
check('snapshot yang sudah ada dikembalikan tanpa perubahan', initialOnlineStore(seeded) === seeded)

const gateway = new FakeGateway()

/* 1. Outlet kosong ---------------------------------------------------------- */

check('outlet kosong menghasilkan null', (await loadStore(gateway, OUTLET)) === null)

/* 2. Seed awal -------------------------------------------------------------- */

const firstSave = await saveStore(gateway, OUTLET, seeded, null, FIXED_NOW)
check('seed awal memasukkan semua baris master', firstSave.inserted === expectedInserts, `${firstSave.inserted}/${expectedInserts}`)
check('seed awal menulis pengaturan outlet', gateway.count('upsert', 'app_settings') === 1)
check('seed awal menulis 5 dokumen pendukung', firstSave.documents === 5, String(firstSave.documents))
check('seed tidak menghapus apa pun', firstSave.deleted === 0)
check('semua menu memakai id uuid', seeded.menus.every((menu) => /^[0-9a-f-]{36}$/i.test(menu.id)))
check('referensi resep menunjuk ingredient uuid', seeded.menus.every((menu) => menu.recipe.every((line) => seeded.ingredients.some((ingredient) => ingredient.id === line.ingredientId))))

/* 3. Baca kembali ----------------------------------------------------------- */

const loaded = await loadStore(gateway, OUTLET)
check('snapshot bisa dibaca kembali', loaded !== null)
check('jumlah menu sama setelah round-trip', loaded?.menus.length === seeded.menus.length, `${loaded?.menus.length}/${seeded.menus.length}`)
check('jumlah bahan sama setelah round-trip', loaded?.ingredients.length === seeded.ingredients.length)
check('nama & harga menu sama', loaded?.menus[0]?.name === seeded.menus[0].name && loaded?.menus[0]?.price === seeded.menus[0].price)
check('resep menu utuh', loaded?.menus[0]?.recipe.length === seeded.menus[0].recipe.length)
check('pengaturan terbaca', loaded?.settings.businessName === seeded.settings.businessName)
check('nomor transaksi berikutnya terbaca', loaded?.nextTransactionNumber === seeded.nextTransactionNumber)
const numberedStore = {
  ...loaded!,
  transactions: [{
    id: 'tx-350', number: 'POS-350', createdAt: FIXED_NOW, orderType: 'Takeaway' as const, paymentMethod: 'Cash' as const,
    items: [], subtotal: 0, paidAmount: 0, change: 0, status: 'completed' as const, shiftId: '',
  }],
}
check('nomor transaksi berikutnya diturunkan dari transaksi terakhir', normalizeStore(numberedStore, { seed: false }).nextTransactionNumber === 351)
check('dokumen kosong terbaca sebagai array', Array.isArray(loaded?.cashMovements) && loaded?.cashMovements.length === 0)

/* 4. Simpan tanpa perubahan -------------------------------------------------- */

gateway.resetCalls()
const noop = await saveStore(gateway, OUTLET, loaded!, loaded!, FIXED_NOW)
check('simpan tanpa perubahan tidak menulis apa pun', noop.inserted === 0 && noop.updated === 0 && noop.deleted === 0 && noop.documents === 0)
check('simpan tanpa perubahan tidak memanggil upsert', gateway.calls.filter((call) => call.op === 'upsert').length === 0)

/* 5. Ubah satu menu --------------------------------------------------------- */

const renamed = { ...loaded!, menus: loaded!.menus.map((menu, index) => index === 0 ? { ...menu, name: 'Menu Uji Online' } : menu) }
gateway.resetCalls()
const updated = await saveStore(gateway, OUTLET, renamed, loaded!, FIXED_NOW)
check('ubah satu menu hanya mengirim satu baris', updated.updated === 1 && gateway.count('upsert', 'menu_items') === 1, `${updated.updated}`)
check('baris lain tidak ikut dikirim', gateway.count('upsert', 'ingredients') === 0 && gateway.count('upsert', 'transactions') === 0)
check('updated_at diisi waktu simpan', gateway.tables.menu_items?.every((row) => row.updated_at === FIXED_NOW) === true)

/* 6. Hapus satu bahan ------------------------------------------------------- */

const removedIngredient = loaded!.ingredients[0]
const trimmedStore = {
  ...loaded!,
  ingredients: loaded!.ingredients.filter((ingredient) => ingredient.id !== removedIngredient.id),
  menus: loaded!.menus.map((menu) => ({ ...menu, recipe: menu.recipe.filter((line) => line.ingredientId !== removedIngredient.id) })),
}
gateway.resetCalls()
const deleted = await saveStore(gateway, OUTLET, trimmedStore, loaded!, FIXED_NOW)
check('hapus bahan mengirim satu id', deleted.deleted === 1 && gateway.count('remove', 'ingredients') === 1)
const afterDelete = await loadStore(gateway, OUTLET)
check('bahan terhapus tidak muncul lagi', afterDelete?.ingredients.every((ingredient) => ingredient.id !== removedIngredient.id) === true)
check('resep yang menunjuk bahan terhapus ikut bersih', afterDelete?.menus.every((menu) => menu.recipe.every((line) => line.ingredientId !== removedIngredient.id)) === true)

/* 7. Dokumen pendukung ------------------------------------------------------ */

const withMovement = {
  ...afterDelete!,
  cashMovements: [{ id: 'kas-1', createdAt: FIXED_NOW, type: 'in' as const, amount: 25000, note: 'Tambahan kas', shiftId: '' }],
  auditLog: [{ id: 'audit-1', createdAt: FIXED_NOW, action: 'cash_in' as const, detail: 'Kas masuk uji' }],
}
const documentSave = await saveStore(gateway, OUTLET, withMovement, afterDelete!, FIXED_NOW)
check('perubahan dokumen hanya menulis dokumen yang berubah', documentSave.documents === 2, String(documentSave.documents))
const withDocs = await loadStore(gateway, OUTLET)
check('kas masuk tersimpan', withDocs?.cashMovements.length === 1 && withDocs.cashMovements[0].amount === 25000)
check('audit log tersimpan', withDocs?.auditLog.some((entry) => entry.id === 'audit-1') === true)

/* 8. Nilai numeric dari PostgREST ------------------------------------------ */

const menuRows = gateway.tables.menu_items ?? []
if (menuRows[0]) menuRows[0].price = '17500.50'
const numericLoaded = await loadStore(gateway, OUTLET)
check('harga numeric berbentuk string dibaca sebagai angka', numericLoaded?.menus.find((menu) => menu.id === String(menuRows[0]?.id))?.price === 17500.5)
if (menuRows[0]) menuRows[0].price = 'rusak'
const brokenLoaded = await loadStore(gateway, OUTLET)
check('harga rusak jatuh ke 0, bukan NaN', brokenLoaded?.menus.every((menu) => Number.isFinite(menu.price)) === true)
if (menuRows[0]) menuRows[0].price = 16000

/* 9. Isolasi outlet -------------------------------------------------------- */

await gateway.upsert('menu_items', [{ id: 'menu-outlet-lain', outlet_id: OTHER_OUTLET, name: 'Menu Outlet Lain', category: 'Uji', price: 1000, emoji: '🍽️', active: true, recipe: [] }])
const firstOutlet = await loadStore(gateway, OUTLET)
const secondOutlet = await loadStore(gateway, OTHER_OUTLET)
check('outlet lain tidak bocor ke outlet pertama', firstOutlet?.menus.every((menu) => menu.id !== 'menu-outlet-lain') === true)
check('outlet kedua hanya melihat datanya sendiri', secondOutlet?.menus.length === 1 && secondOutlet.menus[0].name === 'Menu Outlet Lain')

/* 10. Driver online -------------------------------------------------------- */

const driverGateway = new FakeGateway()
const driver = createOnlineDriver(driverGateway, OUTLET, seeded, 5)
const firstSavePromise = driver.save(seeded)
const secondStore = { ...seeded, settings: { ...seeded.settings, businessName: 'Warung Uji' } }
const secondSavePromise = driver.save(secondStore)
await Promise.all([firstSavePromise, secondSavePromise])
check('dua perubahan beruntun menjadi satu penulisan pengaturan', driverGateway.count('upsert', 'app_settings') === 1, String(driverGateway.count('upsert', 'app_settings')))
const driverLoaded = await loadStore(driverGateway, OUTLET)
check('driver menyimpan versi terbaru', driverLoaded?.settings.businessName === 'Warung Uji')

const failingGateway = new FakeGateway()
failingGateway.failOn = 'menu_items'
const failingDriver = createOnlineDriver(failingGateway, OUTLET, seeded, 1)
const changedForFailure = { ...seeded, menus: seeded.menus.map((menu, index) => index === 0 ? { ...menu, name: 'Menu Gagal Simpan' } : menu) }
let rejected = false
await failingDriver.save(changedForFailure).catch(() => { rejected = true })
check('error jaringan ditolak agar UI bisa menampilkan alert', rejected)
check('ID outlet tetap dipakai pada setiap baris', seeded.menus.every((menu) => gateway.tables.menu_items?.some((row) => row.id === menu.id && row.outlet_id === OUTLET) === true))

/* 11. Akses outlet (baris staf akun, bukan env) ----------------------------- */

type StaffResult = { data: Row | null; error: { message: string } | null }

const staffClient = (result: StaffResult): SupabaseClient => ({
  from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => result }) }) }),
}) as unknown as SupabaseClient

const ownerAccess = await readOutletAccess(staffClient({ data: { outlet_id: OUTLET, role: 'owner' }, error: null }))
check('outlet diambil dari baris staf akun', ownerAccess?.outletId === OUTLET && ownerAccess.role === 'owner')
const cashierAccess = await readOutletAccess(staffClient({ data: { outlet_id: OUTLET, role: 'cashier' }, error: null }))
check('role kasir terdeteksi agar mode pemilik diblokir dengan pesan jelas', cashierAccess?.role === 'cashier')
check('akun tanpa baris staf mengembalikan null (memicu create_outlet)', (await readOutletAccess(staffClient({ data: null, error: null }))) === null)
check('error membaca staf tidak ditelan', await readOutletAccess(staffClient({ data: null, error: { message: 'jaringan mati' } })).then(() => false).catch(() => true))
check('pesan RLS diterjemahkan menjadi langkah perbaikan', describeRepoError('menyimpan', 'menu_categories', 'new row violates row-level security policy for table "menu_categories"').message.includes('owner'))
check('pesan non-RLS tetap menyebut tabel', describeRepoError('memuat', 'menu_items', 'jaringan mati').message.includes('menu_items'))

/* 12. Deteksi outlet yang belum pernah dipakai ----------------------------- */

const untouchedGateway = new FakeGateway()
await untouchedGateway.upsert('app_settings', [{ outlet_id: OUTLET, data: {} }])
check('app_settings {} terdeteksi sebagai outlet baru yang belum punya data', (await loadStore(untouchedGateway, OUTLET)) === null)

const configuredGateway = new FakeGateway()
await configuredGateway.upsert('app_settings', [{ outlet_id: OUTLET, data: { businessName: 'Warung Uji' } }])
check('outlet yang sudah menyimpan pengaturan tidak di-seed ulang', (await loadStore(configuredGateway, OUTLET)) !== null)

/* Ringkasan ---------------------------------------------------------------- */

console.log('')
console.log(`${passed}/${passed + failed} pemeriksaan repo lolos`)
if (failed > 0) {
  console.log(`${failed} pemeriksaan gagal`)
  process.exit(1)
}
