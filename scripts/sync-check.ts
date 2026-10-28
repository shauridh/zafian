/**
 * Pemeriksaan Fase 0: migrasi metadata sync v8 + exporter backup → staging.
 *
 * Fokus:
 * - state lama mendapat metadata sync tanpa mengubah data bisnis;
 * - normalisasi tetap idempoten (dijalankan dua kali hasilnya sama);
 * - staging memetakan kategori→menu, shift lama, resep, dan jurnal dengan FK valid;
 * - angka kontrol (penjualan, kas per shift, debit/kredit jurnal) cocok dengan aplikasi;
 * - CLI menulis 19 tabel JSONL + manifest ber-checksum, dan menolak file rusak.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { applyRestoredStore, inspectBackup, inspectBackupValue } from '../src/lib/backup'
import { normalizeStore } from '../src/lib/schema'
import { buildStagingExport, LEGACY_SHIFT_ID, STAGING_TABLES } from '../src/lib/sync-staging'
import { SCHEMA_VERSION, cashSalesForShift, expectedCashForShift, type PosStore } from '../src/domain/pos'

const fixturePath = join(process.cwd(), 'scripts/fixtures/supabase-seed.json')
const fixtureRaw = readFileSync(fixturePath, 'utf8')
const fixture = JSON.parse(fixtureRaw) as { store: PosStore }
const fixtureStore = normalizeStore(fixture.store)

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`PASS ${name}`)
  else { failures += 1; console.error(`FAIL ${name} ${detail}`) }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const unique = (rows: Record<string, unknown>[], key: string): boolean => new Set(rows.map((row) => String(row[key]))).size === rows.length
const hasNonFinite = (value: unknown): boolean => {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(hasNonFinite)
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasNonFinite)
  return false
}

// ---- 1. Migrasi skema v8 dan metadata sync -------------------------------
check('skema aplikasi naik ke v8', SCHEMA_VERSION === 8, String(SCHEMA_VERSION))

const legacyRaw = clone(fixture.store) as unknown as Record<string, unknown>
delete legacyRaw.sync
legacyRaw.schemaVersion = 6
const migrated = normalizeStore(legacyRaw)
check('state v6 tanpa metadata mendapat sync', Boolean(migrated.sync) && migrated.schemaVersion === 8, JSON.stringify(migrated.sync))
check('outlet/device placeholder deterministik', migrated.sync.outletId === 'outlet-local' && migrated.sync.deviceId === 'device-local', JSON.stringify(migrated.sync))
check('revision minimal 1', Number.isInteger(migrated.sync.revision) && migrated.sync.revision >= 1, String(migrated.sync.revision))
check('updatedAt diturunkan dari waktu bisnis terakhir', migrated.sync.updatedAt === '2026-10-26T15:00:00.000Z', migrated.sync.updatedAt)
check('migrasi v8 idempoten', JSON.stringify(normalizeStore(migrated)) === JSON.stringify(migrated))
check('data bisnis tidak berubah saat migrasi', migrated.transactions.length === fixtureStore.transactions.length && migrated.menus[0]?.price === fixtureStore.menus[0]?.price)

const configuredRaw = clone(legacyRaw)
configuredRaw.sync = { outletId: '7d9a1b2c-3e4f-4a5b-8c6d-7e8f90123456', deviceId: 'kasir-utama', revision: 9, updatedAt: '2026-10-01T00:00:00.000Z' }
const configured = normalizeStore(configuredRaw)
check('identitas sync pengguna dipertahankan', configured.sync.outletId === '7d9a1b2c-3e4f-4a5b-8c6d-7e8f90123456' && configured.sync.deviceId === 'kasir-utama' && configured.sync.revision === 9)
check('updatedAt tidak bergerak mundur', configured.sync.updatedAt === '2026-10-26T15:00:00.000Z', configured.sync.updatedAt)

const currentDevice = normalizeStore({ ...clone(fixture.store), sync: { outletId: 'outlet-a', deviceId: 'device-sekarang', revision: 3, updatedAt: '2026-10-26T12:00:00.000Z' } })
const restoredDevice = normalizeStore({ ...clone(fixture.store), sync: { outletId: 'outlet-b', deviceId: 'device-backup', revision: 8, updatedAt: '2026-10-20T00:00:00.000Z' } })
const restored = applyRestoredStore(restoredDevice, currentDevice, 'uji.json')
check('restore tidak memindahkan identitas perangkat', restored.sync.deviceId === 'device-sekarang' && restored.sync.outletId === 'outlet-a', JSON.stringify(restored.sync))
check('restore mempertahankan revision tertinggi', restored.sync.revision === 8, String(restored.sync.revision))

// ---- 2. Fixture bersih ---------------------------------------------------
check('fixture fixture bukan backup rusak', inspectBackupValue(fixture).ok, JSON.stringify(inspectBackupValue(fixture)))
check('fixture tidak menyimpan PIN/kode pemulihan', !/ownerPin|recoverySalt|recoveryHash/.test(fixtureRaw))

// ---- 3. Exporter atas fixture nyata -------------------------------------
const before = JSON.stringify(fixtureStore)
const result = buildStagingExport(fixtureStore)
const { tables, manifest } = result
check('exporter tidak mengubah input', JSON.stringify(fixtureStore) === before)
check('tidak ada error validasi pada fixture', manifest.issues.filter((issue) => issue.severity === 'error').length === 0, JSON.stringify(manifest.issues))
check('tidak ada peringatan pada fixture bersih', manifest.issues.filter((issue) => issue.severity === 'warning').length === 0, JSON.stringify(manifest.issues))
check('19 tabel staging tersedia', STAGING_TABLES.every((table) => Array.isArray(tables[table])), STAGING_TABLES.join(','))
check('tidak ada angka NaN/Infinity di staging', !hasNonFinite(tables))

const expectedCounts: [keyof typeof tables, number][] = [
  ['categories', 5], ['menus', 11], ['ingredients', 23], ['menu_recipes', 69],
  ['shifts', 2], ['transactions', 4], ['transaction_items', 5], ['cash_movements', 3],
  ['stock_movements', 2], ['expenses', 1], ['preorders', 1], ['preorder_items', 1],
  ['accounts', 13], ['audit_log', 3], ['outlets', 1], ['outlet_settings', 1], ['outlet_counters', 1],
]
for (const [table, count] of expectedCounts) {
  check(`jumlah ${table} = ${count}`, tables[table].length === count, String(tables[table].length))
}
check('manifest count sinkron dengan tabel', STAGING_TABLES.every((table) => manifest.counts[table] === tables[table].length))

// ---- 4. Integritas katalog ----------------------------------------------
const categoryIds = new Set(tables.categories.map((row) => String(row.id)))
check('setiap menu punya category_id valid', tables.menus.every((row) => categoryIds.has(String(row.category_id))), JSON.stringify(tables.menus.filter((row) => !categoryIds.has(String(row.category_id)))))
check('sort_order kategori berurutan dari 0', tables.categories.every((row, index) => row.sort_order === index))
const ingredientIds = new Set(tables.ingredients.map((row) => String(row.id)))
check('setiap resep punya ingredient_id valid', tables.menu_recipes.every((row) => ingredientIds.has(String(row.ingredient_id))))
check('setiap resep punya menu_id valid', tables.menu_recipes.every((row) => tables.menus.some((menu) => menu.id === row.menu_id)))
check('qty resep > 0', tables.menu_recipes.every((row) => Number(row.qty) > 0))
const recipeKeys = tables.menu_recipes.map((row) => `${row.outlet_id}|${row.menu_id}|${row.ingredient_id}`)
check('kunci primer resep unik', new Set(recipeKeys).size === recipeKeys.length)

// ---- 5. Integritas operasional ------------------------------------------
const shiftIds = new Set(tables.shifts.map((row) => String(row.id)))
check('semua transaksi punya shift valid', tables.transactions.every((row) => Boolean(row.shift_id) && shiftIds.has(String(row.shift_id))))
check('semua kas punya shift valid', tables.cash_movements.every((row) => shiftIds.has(String(row.shift_id))))
check('hanya satu shift open', tables.shifts.filter((row) => row.status === 'open').length <= 1)
check('nomor transaksi unik', unique(tables.transactions, 'number'))
const transactionIds = new Set(tables.transactions.map((row) => String(row.id)))
check('item transaksi punya parent valid', tables.transaction_items.every((row) => transactionIds.has(String(row.transaction_id))))
check('line_no item transaksi berurutan', tables.transaction_items.every((row) => Number(row.line_no) > 0))
const preorderIds = new Set(tables.preorders.map((row) => String(row.id)))
check('item pre-order punya parent valid', tables.preorder_items.every((row) => preorderIds.has(String(row.preorder_id))))
check('referensi transaksi pre-order valid', tables.preorders.every((row) => row.transaction_id === null || transactionIds.has(String(row.transaction_id))))
check('stok memakai bahan valid', tables.stock_movements.every((row) => ingredientIds.has(String(row.ingredient_id))))

for (const table of ['outlets', 'outlet_settings', 'outlet_counters', 'categories', 'menus', 'ingredients', 'shifts', 'transactions', 'transaction_items', 'cash_movements', 'stock_movements', 'expenses', 'preorders', 'preorder_items', 'journal_entries', 'journal_lines', 'audit_log'] as const) {
  check(`primary key ${table} unik`, unique(tables[table], 'id'))
}
check('kode akun unik', unique(tables.accounts, 'code'))
check('journal_lines menunjuk entry valid', tables.journal_lines.every((row) => tables.journal_entries.some((entry) => entry.id === row.entry_id)))
const accountCodes = new Set(tables.accounts.map((row) => String(row.code)))
check('journal_lines memakai akun valid', tables.journal_lines.every((row) => accountCodes.has(String(row.account_code))))

// ---- 6. Angka kontrol ----------------------------------------------------
check('jurnal seimbang', manifest.control.journals.balanced && manifest.control.journals.debit === manifest.control.journals.credit, JSON.stringify(manifest.control.journals))
check('jumlah baris jurnal sinkron', manifest.control.journals.lines === tables.journal_lines.length)
check('penjualan kontrol = subtotal transaksi selesai', manifest.control.money.revenue === 70000, String(manifest.control.money.revenue))
check('kas tunai kontrol = Rp40.000', manifest.control.money.cashSales === 40000, String(manifest.control.money.cashSales))
check('QRIS dan unpaid terpisah', manifest.control.money.qrisSales === 15000 && manifest.control.money.unpaidSales === 15000, JSON.stringify(manifest.control.money))
const shift1 = manifest.control.shifts.find((row) => row.shiftId === 'shift-1')
const shift2 = manifest.control.shifts.find((row) => row.shiftId === 'shift-2')
check('kas shift-1 = float + tunai + in - out', shift1?.expectedCash === 396000 && shift1?.actualCash === 396000 && shift1?.variance === 0, JSON.stringify(shift1))
check('kas shift-2 terbuka belum punya selisih', shift2?.expectedCash === 384000 && shift2?.actualCash === null && shift2?.variance === null, JSON.stringify(shift2))
check('kas per shift cocok dengan fungsi aplikasi', fixtureStore.shifts.every((shift) => {
  const row = manifest.control.shifts.find((item) => item.shiftId === shift.id)
  return row !== undefined && row.cashSales === cashSalesForShift(fixtureStore, shift.id) && row.expectedCash === expectedCashForShift(fixtureStore, shift)
}))
check('nilai pembelian & opname kontrol', manifest.control.inventory.purchaseValue === 23500 && manifest.control.inventory.opnameAdjustment === 6275, JSON.stringify(manifest.control.inventory))

// ---- 7. Pemetaan pengaturan & lokal-saja --------------------------------
const settingsRow = tables.outlet_settings[0] ?? {}
check('pengaturan struk masuk outlet_settings', settingsRow.paper_width === 80 && settingsRow.header_align === 'center' && settingsRow.copies === 2 && settingsRow.show_order_type === false)
check('app_schema_version = 8', settingsRow.app_schema_version === 8, String(settingsRow.app_schema_version))
check('tema & printer perangkat tidak ikut cloud', !('theme' in settingsRow) && !('printer' in settingsRow) && !('device_name' in settingsRow) && !('auto_print' in settingsRow))
check('PIN tidak pernah masuk staging', !/ownerPin|owner_pin|recoverySalt|recoveryHash/.test(JSON.stringify(tables)))
check('held order dikecualikan', manifest.excluded.heldOrders === 1 && !('held_orders' in tables))
check('counter memakai nomor berikutnya', tables.outlet_counters[0]?.next_transaction_number === 278)
check('manifest memuat daftar ID katalog & transaksi', manifest.ids.categories.length === 5 && manifest.ids.menus.length === 11 && manifest.ids.ingredients.length === 23 && manifest.ids.transactions.length === 4 && manifest.ids.shifts.length === 2, JSON.stringify(manifest.ids))
check('semua ID di manifest unik', Object.values(manifest.ids).every((values) => new Set(values).size === values.length))

// ---- 8. Idempotensi & varian input --------------------------------------
check('export dua kali identik', JSON.stringify(buildStagingExport(fixtureStore)) === JSON.stringify(result))
const rawInspection = inspectBackupValue(fixture.store)
check('backup mentah (tanpa wrapper) diterima', rawInspection.ok && JSON.stringify(buildStagingExport(rawInspection.store).tables) === JSON.stringify(tables))

const duplicateRecipe = clone(fixtureStore)
duplicateRecipe.menus[0].recipe.push({ ...duplicateRecipe.menus[0].recipe[0] })
const duplicateResult = buildStagingExport(duplicateRecipe)
const mergedRow = duplicateResult.tables.menu_recipes.find((row) => row.menu_id === duplicateRecipe.menus[0].id && row.ingredient_id === duplicateRecipe.menus[0].recipe[0].ingredientId)
check('resep duplikat digabung, bukan menggandakan PK', mergedRow?.qty === duplicateRecipe.menus[0].recipe[0].qty * 2, JSON.stringify(mergedRow))
check('penggabungan resep memberi peringatan', duplicateResult.manifest.issues.some((issue) => issue.code === 'recipe_duplicates_merged'))

const orphanStock = clone(fixtureStore)
orphanStock.stockMovements.push({ id: 'stock-orphan', createdAt: '2026-10-26T11:00:00.000Z', ingredientId: 'bahan-hilang', type: 'purchase', qty: 1, totalCost: 1000, note: 'Uji' })
const orphanStockResult = buildStagingExport(orphanStock)
check('bahan yatim dilaporkan sebagai error', orphanStockResult.manifest.issues.some((issue) => issue.code === 'stock_missing_ingredient' && issue.severity === 'error'))

const legacyStore = clone(fixtureStore)
legacyStore.transactions[0].shiftId = ''
legacyStore.cashMovements[0].shiftId = 'shift-tidak-ada'
const legacyResult = buildStagingExport(legacyStore)
const legacyShift = legacyResult.tables.shifts.find((row) => row.id === LEGACY_SHIFT_ID)
check('shift legacy dibuat untuk referensi kosong', Boolean(legacyShift) && legacyShift?.opening_float === 0 && legacyShift?.status === 'closed', JSON.stringify(legacyShift))
check('transaksi tanpa shift dipetakan ke shift legacy', legacyResult.tables.transactions.find((row) => row.id === 'txn-1')?.shift_id === LEGACY_SHIFT_ID)
check('kas dengan shift hilang dipetakan ke shift legacy', legacyResult.tables.cash_movements.find((row) => row.id === 'cash-1')?.shift_id === LEGACY_SHIFT_ID)
check('pemetaan shift legacy diberi peringatan', legacyResult.manifest.issues.some((issue) => issue.code === 'legacy_shift_synthesized'))
check('shift legacy tercatat di manifest', legacyResult.manifest.derived.legacyShiftId === LEGACY_SHIFT_ID)
check('daftar ID shift memuat shift legacy', legacyResult.manifest.ids.shifts.includes(LEGACY_SHIFT_ID))

const twoOpen = clone(fixtureStore)
twoOpen.shifts[0].status = 'open'
twoOpen.shifts[0].closedAt = undefined
check('dua shift open ditolak', buildStagingExport(twoOpen).manifest.issues.some((issue) => issue.code === 'multiple_open_shifts'))

const missingPreorderTxn = clone(fixtureStore)
missingPreorderTxn.preOrders[0].transactionId = 'txn-hilang'
const missingPreorderResult = buildStagingExport(missingPreorderTxn)
check('pre-order dengan transaksi hilang diberi peringatan', missingPreorderResult.manifest.issues.some((issue) => issue.code === 'preorder_missing_transaction'))
check('referensi transaksi pre-order kosong, bukan menggantung', missingPreorderResult.tables.preorders[0]?.transaction_id === null)

check('backup asing ditolak', !inspectBackupValue({ format: 'bukan-backup' }).ok)
check('JSON rusak ditolak', !inspectBackup('{rusak').ok)

// ---- 9. CLI menulis staging + checksum ---------------------------------
const workDir = mkdtempSync(join(tmpdir(), 'sabana-sync-'))
try {
  const outDir = join(workDir, 'staging')
  const cli = spawnSync('bun', ['run', 'scripts/supabase-export.ts', '--input', 'scripts/fixtures/supabase-seed.json', '--out', outDir], { cwd: process.cwd(), encoding: 'utf8' })
  check('CLI exporter exit 0', cli.status === 0, cli.stderr || cli.stdout)
  check('CLI menulis manifest.json', existsSync(join(outDir, 'manifest.json')))
  const written = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as { files: { table: string; file: string; sha256: string; rows: number }[]; counts: Record<string, number> }
  check('manifest memuat 19 file tabel', written.files.length === STAGING_TABLES.length, String(written.files.length))
  const checksumsOk = written.files.every((file) => {
    const content = readFileSync(join(outDir, file.file), 'utf8')
    return createHash('sha256').update(content).digest('hex') === file.sha256
  })
  check('checksum semua file JSONL cocok', checksumsOk)
  check('manifest CLI memuat angka kontrol', (written as unknown as { control?: { journals?: { balanced?: boolean } } }).control?.journals?.balanced === true)
  check('manifest CLI memuat daftar ID', (written as unknown as { ids?: { transactions?: string[] } }).ids?.transactions?.length === 4, JSON.stringify((written as unknown as { ids?: unknown }).ids))
  const transactionsJsonl = readFileSync(join(outDir, 'transactions.jsonl'), 'utf8').trim().split('\n')
  check('transactions.jsonl berisi 4 baris JSON valid', transactionsJsonl.length === 4 && transactionsJsonl.every((line) => Boolean(JSON.parse(line).id)))

  const brokenPath = join(workDir, 'broken.json')
  writeFileSync(brokenPath, '{"format":"sabana-pos-backup","formatVersion":1,"schemaVersion":7}', 'utf8')
  const brokenOut = join(workDir, 'broken-out')
  const broken = spawnSync('bun', ['run', 'scripts/supabase-export.ts', '--input', brokenPath, '--out', brokenOut], { cwd: process.cwd(), encoding: 'utf8' })
  check('CLI menolak backup rusak (exit 1)', broken.status === 1, String(broken.status))
  check('CLI tidak menulis staging untuk backup rusak', !existsSync(brokenOut))
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} pemeriksaan sync gagal`)
  process.exit(1)
}
console.log('\nSemua pemeriksaan sync lolos')
