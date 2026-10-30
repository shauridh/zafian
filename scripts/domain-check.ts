import { buildJournals, balanceSheet, chartOfAccounts, pnl, trialBalance } from '../src/domain/accounting'
import { buildOverviewSummary, percentDelta, resolvePeriod } from '../src/domain/analytics'
import { defaultRecipeQty, menuHpp, menuMargin, mergeIngredientUsage, scaleRecipe, seedCategories, seedIngredientCategories, seedIngredients, seedMenus } from '../src/domain/catalog'
import { createDefaultSettings } from '../src/domain/settings'
import { cogsForTransactions, inventoryRows } from '../src/domain/inventory'
import { cashSalesForShift, cashShortAgainstFloat, expectedCashForShift, handoverToOwner, initialPosStore, preOrderCanStartProcessing, preOrderRemaining, SCHEMA_VERSION, type PosStore, type Shift, type Transaction } from '../src/domain/pos'
import { exportStore, parseStoreBackup } from '../src/lib/persistence'
import { applyRestoredStore, createBackupRecord, inspectBackup, serializeBackup } from '../src/lib/backup'
import { disconnectBluetoothPrinter, isBluetoothPrinterConnected, requestBluetoothPrinter, sendReceiptTextToBluetooth } from '../src/lib/bluetooth-printer'
import { disconnectPrinter as disconnectActivePrinter, getPrinterTransportStatus, pairPrinter as pairWithActiveTransport, sendReceiptText as sendWithActiveTransport } from '../src/lib/printer-connection'
import { brandingFromSettings, buildReceiptText, printReceiptPreferred } from '../src/lib/receipt'
import { normalizeStore } from '../src/lib/schema'

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.error(`FAIL ${name} ${detail}`)
  }
}

const shift: Shift = { id: 'shift-1', openedAt: new Date().toISOString(), openingFloat: 350000, status: 'open' }

// ---- Setoran ke owner pada rekonsiliasi shift ----
check('setoran owner = kas fisik − float awal', handoverToOwner(shift, 385000) === 35000, String(handoverToOwner(shift, 385000)))
check('shift tanpa transaksi tidak menyetor apa pun', handoverToOwner(shift, 350000) === 0, String(handoverToOwner(shift, 350000)))
check('setoran owner tidak pernah negatif saat kas kurang', handoverToOwner(shift, 100000) === 0, String(handoverToOwner(shift, 100000)))
check('kekurangan kas dihitung terhadap float awal', cashShortAgainstFloat(shift, 100000) === 250000, String(cashShortAgainstFloat(shift, 100000)))
check('kas di atas float tidak dianggap kurang', cashShortAgainstFloat(shift, 385000) === 0)
check('setoran dibulatkan ke rupiah penuh', handoverToOwner(shift, 350500.6) === 501 && handoverToOwner(shift, 350000.4) === 0, `${handoverToOwner(shift, 350500.6)} / ${handoverToOwner(shift, 350000.4)}`)
check('kas tidak valid tidak menghasilkan setoran', handoverToOwner(shift, Number.NaN) === 0 && cashShortAgainstFloat(shift, Number.NaN) === 0)

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: `tx-${Math.random()}`,
    number: 'POS-TEST',
    createdAt: new Date().toISOString(),
    orderType: 'Takeaway',
    paymentMethod: 'Cash',
    items: [],
    subtotal: 0,
    paidAmount: 0,
    change: 0,
    status: 'completed',
    shiftId: shift.id,
    ...overrides,
  }
}

const cashSale = transaction({ items: [{ id: 'dada', name: 'Ayam Dada + Nasi', category: 'Paket', price: 15000, qty: 1 }], subtotal: 15000, paidAmount: 50000, change: 35000 })
const qrisSale = transaction({ paymentMethod: 'QRIS', subtotal: 20000, paidAmount: 20000, change: 0 })

const baseStore: PosStore = {
  schemaVersion: SCHEMA_VERSION,
  transactions: [cashSale, qrisSale],
  cashMovements: [
    { id: 'in-1', createdAt: new Date().toISOString(), type: 'in', amount: 10000, note: 'Tambahan kas', shiftId: shift.id },
    { id: 'out-1', createdAt: new Date().toISOString(), type: 'out', amount: 5000, note: 'Beli es batu', shiftId: shift.id },
  ],
  shifts: [shift],
  heldOrders: [],
  preOrders: [],
  menus: seedMenus,
  categories: seedCategories,
  ingredients: seedIngredients,
  stockMovements: [],
  expenses: [],
  auditLog: [],
  settings: createDefaultSettings(),
  nextTransactionNumber: 1,
}

check('pemakaian standar bahan mengisi jumlah resep otomatis', defaultRecipeQty('tepung-bumbu', seedMenus, { 'tepung-bumbu': 37 }) === 37, String(defaultRecipeQty('tepung-bumbu', seedMenus, { 'tepung-bumbu': 37 })))
check('tanpa standar, jumlah diambil dari resep yang paling sering dipakai', defaultRecipeQty('tepung-bumbu', seedMenus, {}) === 37.5, String(defaultRecipeQty('tepung-bumbu', seedMenus, {})))
check('bahan tanpa riwayat resep memakai jumlah 1', defaultRecipeQty('bahan-baru', seedMenus, {}) === 1, String(defaultRecipeQty('bahan-baru', seedMenus, {})))
check('standar tidak valid diabaikan', defaultRecipeQty('tepung-bumbu', seedMenus, { 'tepung-bumbu': -5 }) === 37.5, String(defaultRecipeQty('tepung-bumbu', seedMenus, { 'tepung-bumbu': -5 })))
check('pemakaian standar disaring saat normalisasi', normalizeStore({ settings: { ingredientUsage: { a: 37, b: 0, c: 'x' } } }).settings.ingredientUsage?.['a'] === 37 && Object.keys(normalizeStore({ settings: { ingredientUsage: { a: 37, b: 0, c: 'x' } } }).settings.ingredientUsage ?? {}).length === 1, JSON.stringify(normalizeStore({ settings: { ingredientUsage: { a: 37, b: 0, c: 'x' } } }).settings.ingredientUsage))

const scaled = scaleRecipe([{ ingredientId: 'tepung-bumbu', qty: 37.5 }, { ingredientId: 'beras', qty: 110 }, { ingredientId: '', qty: 5 }, { ingredientId: 'gas', qty: 0 }], 0.5)
check('salin resep menggandakan porsi sesuai faktor', scaled.length === 2 && scaled[0].qty === 18.75 && scaled[1].qty === 55, JSON.stringify(scaled))
check('salin resep membuang baris bahan tidak valid', scaled.every((line) => line.ingredientId && line.qty > 0))
check('faktor porsi tidak valid dianggap 1', scaleRecipe([{ ingredientId: 'beras', qty: 110 }], -2)[0].qty === 110)

const bulkUsage = mergeIngredientUsage({ a: 10, b: 20, zombie: 5 }, { a: '37', b: '', c: '12', d: '-3' }, ['a', 'b', 'c', 'd'])
check('isi standar massal menyimpan beberapa bahan sekaligus', bulkUsage.usage.a === 37 && bulkUsage.usage.c === 12 && bulkUsage.set === 2, JSON.stringify(bulkUsage))
check('sel kosong di dialog standar menghapus nilai lama', !('b' in bulkUsage.usage) && bulkUsage.cleared === 1, JSON.stringify(bulkUsage.usage))
check('isi standar massal mengabaikan bahan tak dikenal dan angka negatif', !('zombie' in bulkUsage.usage) && !('d' in bulkUsage.usage), JSON.stringify(bulkUsage.usage))
check('bahan yang tidak diubah tetap memakai standar lama', mergeIngredientUsage({ a: 10, b: 20 }, { b: '0' }, ['a', 'b']).usage.a === 10 && !('b' in mergeIngredientUsage({ a: 10, b: 20 }, { b: '0' }, ['a', 'b']).usage))

check('cash sales memakai uang bersih (paid - change)', cashSalesForShift(baseStore, shift.id) === 15000, String(cashSalesForShift(baseStore, shift.id)))
check('QRIS tidak masuk kas fisik', expectedCashForShift(baseStore, shift) === 370000, String(expectedCashForShift(baseStore, shift)))
check('kas seharusnya = float + cash + in - out', expectedCashForShift(baseStore, shift) === 350000 + 15000 + 10000 - 5000)

check('sisa pre-order', preOrderRemaining(100000, 25000) === 75000)
check('DP diterima boleh mulai proses', preOrderCanStartProcessing('dp_received'))
check('selesai tidak boleh mulai proses', !preOrderCanStartProcessing('completed'))

const dada = seedMenus.find((menu) => menu.id === 'dada')!
const hpp = menuHpp(dada, seedIngredients)
check('HPP dada mendekati dokumen (11.201)', hpp > 10500 && hpp < 11800, String(hpp))
const margin = menuMargin(dada, seedIngredients)
check('margin = harga jual - HPP', Math.abs(margin.margin - (dada.price - hpp)) < 0.01)

const cogs = cogsForTransactions([cashSale], seedMenus, seedIngredients)
const journals = buildJournals({ transactions: [cashSale, qrisSale], cashMovements: baseStore.cashMovements, stockMovements: [], expenses: [], hppOf: (item) => cogsForTransactions([item], seedMenus, seedIngredients) })
const trial = trialBalance(journals)
check('jurnal seimbang', trial.balanced, `${trial.debit} vs ${trial.credit}`)
const report = pnl(journals)
check('pendapatan = subtotal transaksi selesai', report.revenue === 35000, String(report.revenue))
check('laba kotor = pendapatan - HPP', Math.abs(report.grossProfit - (report.revenue - report.cogs)) < 0.01)
const sheet = balanceSheet(journals)
check('neraca seimbang', Math.abs(sheet.totalAssets - (sheet.totalLiabilities + sheet.totalEquity)) < 1, `${sheet.totalAssets} vs ${sheet.totalLiabilities + sheet.totalEquity}`)

const forecastRows = inventoryRows(seedIngredients, seedMenus, [cashSale], [], 7)
const ayamRow = forecastRows.find((row) => row.ingredientId === 'ayam-dada')!
check('pemakaian ayam tercatat 1 potong', ayamRow.used === 1, String(ayamRow.used))
check('kebutuhan harian = pemakaian / 7', Math.abs(ayamRow.dailyNeed - 1 / 7) < 0.0001)

const receipt = buildReceiptText(cashSale)
check('struk memuat nomor transaksi', receipt.includes(cashSale.number))
check('struk memuat total', receipt.includes('TOTAL') && receipt.includes('15.000'))
const wideReceipt = buildReceiptText(cashSale, { businessName: 'SABANA CABANG 2', outletName: 'Cabang 2', footer: 'WA 0812-3456', paperWidth: 80 })
const wideRule = wideReceipt.split('\n').find((line) => line.startsWith('---'))
check('struk 80mm memakai lebar 42 karakter', wideRule?.length === 42, String(wideRule?.length))
check('struk memakai identitas & footer pengaturan', wideReceipt.includes('SABANA CABANG 2') && wideReceipt.includes('Cabang 2') && wideReceipt.includes('WA 0812-3456'))
const compactReceipt = buildReceiptText(cashSale, {
  businessName: 'SABANA FRIED CHICKEN', outletName: 'Outlet utama', footer: 'Terima kasih\nSimpan struk ini', paperWidth: 58,
  headerAlign: 'center', footerAlign: 'center', fontSize: 'compact', showOrderType: false, showPaymentDetail: false, copies: 2,
})
const compactLines = compactReceipt.split('\n')
check('header struk bisa ditengahkan', compactLines[0].startsWith(' ') && compactLines[0].trim() === 'SABANA FRIED CHICKEN', JSON.stringify(compactLines[0]))
check('tipe pesanan bisa disembunyikan dari struk', !compactReceipt.includes('Tipe:'))
check('rincian pembayaran bisa disembunyikan dari struk', !compactReceipt.includes('BAYAR') && !compactReceipt.includes('Metode:') && compactReceipt.includes('TOTAL'))
check('footer multi-baris mengikuti perataan tengah', compactLines.slice(-2).every((line) => line.startsWith(' ')), JSON.stringify(compactLines.slice(-2)))

const promoReceipt = buildReceiptText(cashSale, {
  businessName: 'SABANA FRIED CHICKEN', outletName: 'Outlet utama', footer: 'Terima kasih', paperWidth: 58,
  promo: 'Promo hari ini\nBeli 2 gratis 1',
})
check('struk memuat baris promo', promoReceipt.includes('Promo hari ini') && promoReceipt.includes('Beli 2 gratis 1'), JSON.stringify(promoReceipt.slice(-120)))
check('baris promo tampil di bawah catatan kaki', promoReceipt.indexOf('Promo hari ini') > promoReceipt.indexOf('Terima kasih'))

const longPromo = 'Promo akhir pekan: gratis es teh untuk setiap pembelian dua paket ayam geprek spesial'
const wrappedPromo = buildReceiptText(cashSale, { businessName: 'SABANA FRIED CHICKEN', outletName: 'Outlet utama', footer: 'Terima kasih', paperWidth: 58, promo: longPromo })
const wrappedLines = wrappedPromo.split('\n')
const wrappedFooterIndex = wrappedLines.findIndex((receiptLine) => receiptLine.trim() === 'Terima kasih')
const wrappedPromoLines = wrappedLines.slice(wrappedFooterIndex + 2)
check('promo panjang dibungkus tanpa terpotong', wrappedPromoLines.every((receiptLine) => receiptLine.length <= 32) && wrappedPromoLines.join(' ').replace(/\s+/g, ' ').trim() === longPromo, JSON.stringify(wrappedPromoLines))
check('promo panjang tetap di tengah', wrappedPromoLines.every((receiptLine) => receiptLine.length - receiptLine.trimStart().length === Math.floor((32 - receiptLine.trim().length) / 2)), JSON.stringify(wrappedPromoLines))

// ---- Migrasi state versi lama ----
const legacyState = {
  // sengaja tanpa schemaVersion, menus, ingredients, auditLog, stockMovements
  transactions: [
    {
      id: 'old-tx-1',
      number: 'POS-101',
      createdAt: '2026-10-01T10:00:00.000Z',
      orderType: 'Takeaway',
      paymentMethod: 'Cash',
      items: [{ id: 'dada', name: 'Ayam Dada + Nasi', category: 'Paket', price: 15000, qty: 1 }],
      subtotal: 15000,
      // paidAmount & change tidak ada di versi lama
      status: 'completed',
      shiftId: 'shift-old',
    },
  ],
  cashMovements: [{ id: 'old-in', createdAt: '2026-10-01T09:00:00.000Z', type: 'in', amount: 20000, note: 'Kas awal tambahan', shiftId: 'shift-old' }],
  shifts: [{ id: 'shift-old', openedAt: '2026-10-01T08:00:00.000Z', status: 'open' }],
  heldOrders: [],
  preOrders: [
    { id: 'old-po-1', createdAt: '2026-10-01T09:30:00.000Z', customerName: 'Rina', items: [{ id: 'bbq', name: 'Rice Bowl BBQ 650', category: 'Rice bowl', price: 15000, qty: 2 }], total: 30000, status: 'dp_received' },
  ],
}

const migrated = normalizeStore(legacyState)
check('migrasi mengisi versi skema terbaru', migrated.schemaVersion === SCHEMA_VERSION, String(migrated.schemaVersion))
check('migrasi tidak meninggalkan POS kosong', migrated.menus.length > 0 && migrated.ingredients.length > 0)
check('katalog seed dipakai saat daftar kosong', migrated.menus.some((menu) => menu.id === 'dada') && migrated.menus.length === initialPosStore.menus.length)
check('kategori seed tersedia saat daftar kosong', migrated.categories.length >= seedCategories.length && migrated.categories.some((category) => category.name === 'Minuman'), JSON.stringify(migrated.categories))
check('kategori bahan seed tersedia saat daftar kosong', migrated.ingredientCategories.length >= seedIngredientCategories.length && migrated.ingredientCategories.some((category) => category.name === 'Protein'), JSON.stringify(migrated.ingredientCategories))
check('setiap bahan hasil migrasi punya kategori', migrated.ingredients.every((ingredient) => typeof ingredient.category === 'string' && ingredient.category.length > 0), JSON.stringify(migrated.ingredients.slice(0, 2)))
check('menu seed memiliki gambar', migrated.menus.every((menu) => typeof menu.imageUrl === 'string' && menu.imageUrl.length > 0))
check('pengaturan default terpasang saat migrasi', migrated.settings.printer.paperWidth === 58 && migrated.settings.theme === 'light')
check('tata letak struk default aman', migrated.settings.printer.headerAlign === 'left' && migrated.settings.printer.footerAlign === 'left' && migrated.settings.printer.fontSize === 'normal' && migrated.settings.printer.showOrderType && migrated.settings.printer.showPaymentDetail && migrated.settings.printer.copies === 1, JSON.stringify(migrated.settings.printer))
check('audit log lama kosong menjadi array', Array.isArray(migrated.auditLog) && migrated.auditLog.length === 0)
check('paidAmount lama diturunkan dari subtotal', migrated.transactions[0].paidAmount === 15000, String(migrated.transactions[0].paidAmount))
check('change lama menjadi 0', migrated.transactions[0].change === 0, String(migrated.transactions[0].change))
check('shift lama mendapat float default', migrated.shifts[0].openingFloat === 350000, String(migrated.shifts[0].openingFloat))
check('DP lama yang hilang menjadi 0', migrated.preOrders[0].dp === 0, String(migrated.preOrders[0].dp))
check('total pre-order lama dipertahankan', migrated.preOrders[0].total === 30000)

const legacyCash = expectedCashForShift(migrated, migrated.shifts[0])
check('kas setelah migrasi tidak NaN', Number.isFinite(legacyCash) && legacyCash === 350000 + 15000 + 20000, String(legacyCash))

const migratedAgain = normalizeStore(migrated)
check('normalisasi idempoten (deep equal)', JSON.stringify(migratedAgain) === JSON.stringify(migrated))
check('normalisasi tidak menggandakan transaksi', migratedAgain.transactions.length === migrated.transactions.length)
check('normalisasi tidak menggandakan kas', migratedAgain.cashMovements.length === migrated.cashMovements.length)
const journalFirst = buildJournals({ transactions: migrated.transactions, cashMovements: migrated.cashMovements, stockMovements: migrated.stockMovements, expenses: migrated.expenses, hppOf: (item) => cogsForTransactions([item], migrated.menus, migrated.ingredients) })
const journalSecond = buildJournals({ transactions: migratedAgain.transactions, cashMovements: migratedAgain.cashMovements, stockMovements: migratedAgain.stockMovements, expenses: migratedAgain.expenses, hppOf: (item) => cogsForTransactions([item], migratedAgain.menus, migratedAgain.ingredients) })
check('migrasi mempertahankan transaksi lama', migrated.transactions.length === 1, String(migrated.transactions.length))
check('bagan akun tersedia setelah migrasi', chartOfAccounts.length >= 10, String(chartOfAccounts.length))
check('jurnal terbentuk dari transaksi lama (tidak vakum)', journalFirst.length > 0, String(journalFirst.length))
check('jurnal tidak bertambah setelah migrasi diulang', journalFirst.length === journalSecond.length, `${journalFirst.length} vs ${journalSecond.length}`)
check('jurnal migrasi tetap seimbang dan tidak kosong', journalFirst.length > 0 && trialBalance(journalFirst).balanced)

const customCatalog = normalizeStore({
  menus: [{ id: 'es-teh', name: 'Es Teh', category: 'Minuman Dingin', price: 8000, emoji: '🥤', imageUrl: 'data:image/png;base64,contoh', active: true, recipe: [] }],
  categories: [{ id: 'minuman-dingin', name: 'Minuman Dingin' }, { id: 'kopi', name: 'Kopi' }],
})
check('kategori kustom dipertahankan', customCatalog.categories.some((category) => category.name === 'Minuman Dingin'))
check('kategori tanpa menu tetap ada', customCatalog.categories.some((category) => category.name === 'Kopi'))
check('menu dengan gambar kustom dipertahankan', customCatalog.menus[0]?.imageUrl === 'data:image/png;base64,contoh')
check('kategori hasil migrasi idempoten', JSON.stringify(normalizeStore(customCatalog).categories) === JSON.stringify(customCatalog.categories))

const customIngredients = normalizeStore({
  ingredients: [
    { id: 'garam', name: 'Garam', category: 'Bumbu Kering', unit: 'gram', costPerUnit: 10, purchaseUnit: 'pack 1 kg', purchasePrice: 10000, usagePerPurchaseUnit: 1000, minStock: 100 },
    { id: 'gula', name: 'Gula', unit: 'gram', costPerUnit: 15, purchaseUnit: 'pack 1 kg', purchasePrice: 15000, usagePerPurchaseUnit: 1000, minStock: 100 },
  ],
})
check('kategori bahan kustom dipertahankan', customIngredients.ingredientCategories.some((category) => category.name === 'Bumbu Kering'), JSON.stringify(customIngredients.ingredientCategories))
check('bahan tanpa kategori memakai Lainnya', customIngredients.ingredients.find((ingredient) => ingredient.id === 'gula')?.category === 'Lainnya')
check('kategori bahan hasil migrasi idempoten', JSON.stringify(normalizeStore(customIngredients).ingredientCategories) === JSON.stringify(customIngredients.ingredientCategories))

const configured = normalizeStore({
  settings: {
    businessName: 'Sabana Cabang 2', outletName: 'Cabang 2', outletPhone: '0812-3456-7890', receiptFooter: 'WA 0812-3456', theme: 'dark',
    printer: {
      deviceName: 'Thermal Kasir 1', paperWidth: 80, autoPrint: true,
      headerAlign: 'center', footerAlign: 'center', fontSize: 'large',
      showOrderType: false, showPaymentDetail: false, copies: 2,
    },
  },
})
check('pengaturan printer & outlet dipertahankan', configured.settings.printer.paperWidth === 80 && configured.settings.printer.autoPrint && configured.settings.printer.deviceName === 'Thermal Kasir 1', JSON.stringify(configured.settings))
check('tata letak struk pengguna dipertahankan', configured.settings.printer.headerAlign === 'center' && configured.settings.printer.footerAlign === 'center' && configured.settings.printer.fontSize === 'large' && !configured.settings.printer.showOrderType && !configured.settings.printer.showPaymentDetail && configured.settings.printer.copies === 2, JSON.stringify(configured.settings.printer))
check('tema gelap dipertahankan', configured.settings.theme === 'dark')
check('nomor telepon outlet dipertahankan', configured.settings.outletPhone === '0812-3456-7890', configured.settings.outletPhone)
const configuredReceipt = buildReceiptText(cashSale, brandingFromSettings(configured.settings))
check('pengaturan tersimpan dipakai menyusun struk', configuredReceipt.includes('SABANA CABANG 2') && configuredReceipt.includes('Cabang 2') && configuredReceipt.includes('WA 0812-3456'), configuredReceipt.slice(0, 180))
check('nomor telepon tampil di bawah nama outlet pada struk', configuredReceipt.indexOf('0812-3456-7890') > configuredReceipt.indexOf('Cabang 2') && configuredReceipt.indexOf('0812-3456-7890') < configuredReceipt.indexOf('----'), configuredReceipt.slice(0, 160))
check('struk mengikuti lebar 80mm dan menyembunyikan detail', configuredReceipt.split('\n').find((line) => line.startsWith('---'))?.length === 42 && !configuredReceipt.includes('Tipe:') && !configuredReceipt.includes('BAYAR') && configuredReceipt.includes('TOTAL'), configuredReceipt.slice(0, 360))
const invalidSettings = normalizeStore({ settings: { theme: 'neon', printer: { paperWidth: 76, autoPrint: 'ya', headerAlign: 'tengah', fontSize: 'raksasa', copies: 9 } } })
check('pengaturan tidak valid jatuh ke default aman', invalidSettings.settings.theme === 'light' && invalidSettings.settings.printer.paperWidth === 58 && invalidSettings.settings.printer.autoPrint === false, JSON.stringify(invalidSettings.settings.printer))
check('tata letak tidak valid jatuh ke default & salinan dibatasi', invalidSettings.settings.printer.headerAlign === 'left' && invalidSettings.settings.printer.fontSize === 'normal' && invalidSettings.settings.printer.copies === 3, JSON.stringify(invalidSettings.settings.printer))
check('nomor telepon kosong aman untuk data lama', invalidSettings.settings.outletPhone === '', JSON.stringify(invalidSettings.settings.outletPhone))

const imageTransaction = normalizeStore({
  transactions: [{
    id: 'img-1', number: 'POS-IMG', createdAt: '2026-10-02T10:00:00.000Z', orderType: 'Takeaway', paymentMethod: 'Cash',
    items: [{ id: 'dada', name: 'Ayam Dada + Nasi', category: 'Paket', price: 16000, qty: 1, emoji: '🍗', imageUrl: '/menu/paket-dada.svg' }],
    subtotal: 16000, paidAmount: 16000, change: 0, status: 'completed', shiftId: 'shift-old',
  }],
})
check('gambar item transaksi lama dipertahankan', imageTransaction.transactions[0]?.items[0]?.imageUrl === '/menu/paket-dada.svg')

// ---- Opname stok ----
const opnameStore = normalizeStore({
  menus: seedMenus,
  ingredients: seedIngredients,
  stockMovements: [
    { id: 'purchase-beras', createdAt: '2026-10-02T08:00:00.000Z', ingredientId: 'beras', type: 'purchase', qty: 5000, totalCost: 62750, note: 'Beras masuk' },
    { id: 'opname-beras', createdAt: '2026-10-02T20:00:00.000Z', ingredientId: 'beras', type: 'opname', qty: -500, totalCost: 0, note: 'Opname akhir shift', countedQty: 4500, systemQty: 5000 },
  ],
})
const berasOpname = opnameStore.stockMovements.find((movement) => movement.id === 'opname-beras')
check('opname menyimpan snapshot sistem & fisik', berasOpname?.systemQty === 5000 && berasOpname?.countedQty === 4500, JSON.stringify(berasOpname))
const berasStock = inventoryRows(opnameStore.ingredients, opnameStore.menus, [], opnameStore.stockMovements).find((row) => row.ingredientId === 'beras')
check('opname mengurangi stok sesuai selisih', berasStock?.stock === 4500, String(berasStock?.stock))
const zeroOpname = normalizeStore({ stockMovements: [{ id: 'opname-zero', createdAt: '2026-10-02T20:00:00.000Z', ingredientId: 'beras', type: 'opname', qty: 0, totalCost: 0, note: 'Stok sesuai', countedQty: 100, systemQty: 100 }] })
check('opname tanpa selisih tetap tersimpan', zeroOpname.stockMovements.length === 1, String(zeroOpname.stockMovements.length))
check('opname idempoten', JSON.stringify(normalizeStore(opnameStore)) === JSON.stringify(opnameStore))
check('audit opname dipertahankan', normalizeStore({ auditLog: [{ action: 'opname', detail: 'Opname beras' }] }).auditLog[0]?.action === 'opname')

// ---- Jurnal penyesuaian opname ----
check('opname lama mendapat snapshot biaya satuan', berasOpname?.unitCost === 12.55, String(berasOpname?.unitCost))
const opnameOnly = opnameStore.stockMovements.filter((movement) => movement.type === 'opname')
const opnameJournals = buildJournals({ transactions: [], cashMovements: [], stockMovements: opnameOnly, expenses: [], hppOf: () => 0 })
const berasEntry = opnameJournals.find((entry) => entry.id === 'opname-beras-opname')
check('opname membuat jurnal penyesuaian', Boolean(berasEntry), JSON.stringify(berasEntry))
const berasDebit = berasEntry?.lines.find((line) => line.account === '6100')
const berasCredit = berasEntry?.lines.find((line) => line.account === '1200')
check('selisih kurang dibebankan ke Selisih Persediaan', berasDebit?.debit === 6275 && berasDebit?.credit === 0, JSON.stringify(berasDebit))
check('selisih kurang mengurangi Persediaan Bahan', berasCredit?.credit === 6275 && berasCredit?.debit === 0, JSON.stringify(berasCredit))
check('jurnal opname seimbang', trialBalance(opnameJournals).balanced, `${trialBalance(opnameJournals).debit} vs ${trialBalance(opnameJournals).credit}`)
const opnameProfit = pnl(opnameJournals)
check('selisih opname menambah beban operasional', opnameProfit.inventoryAdjustment === 6275 && opnameProfit.operatingExpenses === 6275, JSON.stringify(opnameProfit))
check('selisih opname menurunkan laba bersih', opnameProfit.netProfit === -6275, String(opnameProfit.netProfit))
const opnameSheet = balanceSheet(opnameJournals)
const inventoryAsset = opnameSheet.assets.find((row) => row.code === '1200')
check('neraca memakai nilai persediaan setelah opname', inventoryAsset?.balance === -6275, JSON.stringify(inventoryAsset))
check('neraca tetap seimbang dengan opname', Math.abs(opnameSheet.totalAssets - (opnameSheet.totalLiabilities + opnameSheet.totalEquity)) < 0.01, `${opnameSheet.totalAssets} vs ${opnameSheet.totalLiabilities + opnameSheet.totalEquity}`)

const surplusStore = normalizeStore({
  stockMovements: [{ id: 'opname-surplus', createdAt: '2026-10-02T21:00:00.000Z', ingredientId: 'beras', type: 'opname', qty: 200, totalCost: 0, unitCost: 10, note: 'Stok lebih', countedQty: 5200, systemQty: 5000 }],
})
const surplusJournals = buildJournals({ transactions: [], cashMovements: [], stockMovements: surplusStore.stockMovements, expenses: [], hppOf: () => 0 })
const surplusEntry = surplusJournals.find((entry) => entry.id === 'opname-surplus-opname')
check('selisih lebih menambah Persediaan Bahan', surplusEntry?.lines.find((line) => line.account === '1200')?.debit === 2000, JSON.stringify(surplusEntry))
check('selisih lebih mengurangi beban persediaan', surplusEntry?.lines.find((line) => line.account === '6100')?.credit === 2000, JSON.stringify(surplusEntry))
check('selisih lebih menaikkan laba', pnl(surplusJournals).netProfit === 2000, String(pnl(surplusJournals).netProfit))

const editedOpnameStore = opnameStore.stockMovements.map((movement) => movement.id === 'opname-beras' ? { ...movement, qty: -20, countedQty: 4980 } : movement)
const editedOpnameEntry = buildJournals({ transactions: [], cashMovements: [], stockMovements: editedOpnameStore.filter((movement) => movement.type === 'opname'), expenses: [], hppOf: () => 0 }).find((entry) => entry.id === 'opname-beras-opname')
check('edit opname menyesuaikan nilai jurnal', editedOpnameEntry?.lines.find((line) => line.account === '6100')?.debit === 251, JSON.stringify(editedOpnameEntry))
const removedOpnameJournals = buildJournals({ transactions: [], cashMovements: [], stockMovements: opnameStore.stockMovements.filter((movement) => movement.id !== 'opname-beras'), expenses: [], hppOf: () => 0 })
check('hapus opname menghapus jurnalnya', !removedOpnameJournals.some((entry) => entry.source === 'opname'), JSON.stringify(removedOpnameJournals))
check('opname tanpa selisih tidak membuat jurnal', buildJournals({ transactions: [], cashMovements: [], stockMovements: zeroOpname.stockMovements, expenses: [], hppOf: () => 0 }).length === 0)
const opnameJournalsAgain = buildJournals({ transactions: [], cashMovements: [], stockMovements: normalizeStore(opnameStore).stockMovements.filter((movement) => movement.type === 'opname'), expenses: [], hppOf: () => 0 })
check('jurnal opname tidak berlipat setelah migrasi diulang', JSON.stringify(opnameJournalsAgain) === JSON.stringify(opnameJournals))

// ---- Pembelian massal: stok + jurnal per baris ----
const bulkPurchases = [
  { id: 'bulk-tepung', createdAt: '2026-10-03T08:00:00.000Z', ingredientId: 'tepung-bumbu', type: 'purchase' as const, qty: 1000, totalCost: 23500, note: '1 pack 1 kg Tepung bumbu' },
  { id: 'bulk-beras', createdAt: '2026-10-03T08:01:00.000Z', ingredientId: 'beras', type: 'purchase' as const, qty: 25000, totalCost: 313750, note: '1 karung 25 kg Beras' },
]
const bulkStock = inventoryRows(seedIngredients, seedMenus, [], bulkPurchases)
check('pembelian massal menambah stok tiap bahan', bulkStock.find((row) => row.ingredientId === 'tepung-bumbu')?.stock === 1000 && bulkStock.find((row) => row.ingredientId === 'beras')?.stock === 25000, JSON.stringify(bulkStock.filter((row) => row.ingredientId === 'tepung-bumbu' || row.ingredientId === 'beras')))
const bulkJournals = buildJournals({ transactions: [], cashMovements: [], stockMovements: bulkPurchases, expenses: [], hppOf: () => 0 })
check('pembelian massal membuat jurnal per baris', bulkJournals.filter((entry) => entry.source === 'purchase').length === 2, String(bulkJournals.length))
const bulkInventoryDebit = bulkJournals.flatMap((entry) => entry.lines).filter((line) => line.account === '1200').reduce((sum, line) => sum + line.debit, 0)
const bulkCashCredit = bulkJournals.flatMap((entry) => entry.lines).filter((line) => line.account === '1000').reduce((sum, line) => sum + line.credit, 0)
check('jurnal pembelian massal mendebit persediaan sesuai total', bulkInventoryDebit === 337250, String(bulkInventoryDebit))
check('jurnal pembelian massal mengkredit kas sesuai total', bulkCashCredit === 337250, String(bulkCashCredit))
check('jurnal pembelian massal seimbang', trialBalance(bulkJournals).balanced, `${trialBalance(bulkJournals).debit} vs ${trialBalance(bulkJournals).credit}`)

const customised = normalizeStore({
  menus: seedMenus.map((menu) => menu.id === 'dada' ? { ...menu, price: 21000, active: false } : menu),
  ingredients: seedIngredients,
})
const customDada = customised.menus.find((menu) => menu.id === 'dada')!
check('harga menu milik pengguna tidak di-reset', customDada.price === 21000, String(customDada.price))
check('status nonaktif menu dipertahankan', customDada.active === false)

const backup = parseStoreBackup(exportStore(migrated))
check('backup round-trip konsisten', backup !== null && JSON.stringify(backup) === JSON.stringify(migrated))
const backupRecord = createBackupRecord(migrated, 'daily', '2026-10-26T12:00:00.000Z')
const serializedBackup = serializeBackup(backupRecord)
const inspectedBackup = inspectBackup(serializedBackup)
check('backup memuat format, timestamp, dan versi skema', backupRecord.format === 'sabana-pos-backup' && backupRecord.createdAt === '2026-10-26T12:00:00.000Z' && backupRecord.schemaVersion === SCHEMA_VERSION)
check('backup valid bisa diperiksa beserta ringkasan', inspectedBackup.ok && inspectedBackup.meta.summary.transactions === migrated.transactions.length, inspectedBackup.ok ? JSON.stringify(inspectedBackup.meta.summary) : inspectedBackup.error)
check('backup dari skema lebih baru ditolak', !inspectBackup(JSON.stringify({ ...backupRecord, schemaVersion: SCHEMA_VERSION + 1, store: { ...backupRecord.store, schemaVersion: SCHEMA_VERSION + 1 } })).ok)
check('backup dengan transaksi rusak ditolak', !inspectBackup(JSON.stringify({ ...backupRecord, store: { ...backupRecord.store, transactions: [{ id: 'rusak' }] } })).ok)
check('backup tanpa pengaturan ditolak', !inspectBackup(JSON.stringify({ ...backupRecord, store: { ...backupRecord.store, settings: null } })).ok)
check('format backup tidak dikenal ditolak', !inspectBackup(JSON.stringify({ ...backupRecord, format: 'format-lain' })).ok)
check('nomor transaksi berikutnya tetap valid', migrated.nextTransactionNumber >= 274 && migrated.nextTransactionNumber > 101, String(migrated.nextTransactionNumber))

// ---- Restore store dari backup ----
const restoreCandidate = normalizeStore({ ...migrated, transactions: [cashSale] })
const restoredStore = applyRestoredStore(restoreCandidate, 'uji-restore.json')
check('restore valid menerapkan transaksi dari backup', restoredStore.transactions.length === 1 && restoredStore.transactions[0]?.id === cashSale.id)
check('restore menambahkan audit restore', restoredStore.auditLog.some((entry) => entry.action === 'restore'))

const emptyStore = normalizeStore(null)
check('state kosong tetap mendapat katalog', emptyStore.menus.length > 0 && emptyStore.ingredients.length > 0)
check('state kosong idempoten', JSON.stringify(normalizeStore(emptyStore)) === JSON.stringify(emptyStore))
check('backup rusak ditolak dengan aman', parseStoreBackup('{bukan json') === null)

// ---- Pemilihan transport printer ----
const fakeWindow = {
  isSecureContext: true,
  open: () => ({ document: { write: () => {}, close: () => {} }, focus: () => {}, print: () => {} }),
}
Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true })
const systemStatus = getPrinterTransportStatus()
check('transport sistem dipilih tanpa bridge & Web Bluetooth', systemStatus.kind === 'system' && !systemStatus.canPair && !systemStatus.canSend, JSON.stringify(systemStatus))
const fallbackOutcome = await printReceiptPreferred(cashSale, { copies: 1 })
check('fallback ke dialog cetak saat tidak ada transport', fallbackOutcome.mode === 'dialog', JSON.stringify(fallbackOutcome))

// ---- Ringkasan pemilik: periode, metrik, dan tren ----
const summaryNow = new Date(2026, 9, 26, 12, 0, 0)
const summaryShift: Shift = { id: 'shift-summary', openedAt: new Date(2026, 9, 26, 8, 0, 0).toISOString(), openingFloat: 350000, status: 'open' }
const summaryCash = transaction({
  id: 'summary-cash', createdAt: new Date(2026, 9, 26, 10, 15, 0).toISOString(), subtotal: 30000, paidAmount: 50000, change: 20000,
  items: [{ id: 'dada', name: 'Ayam Dada + Nasi', category: 'Paket', price: 15000, qty: 2 }], shiftId: summaryShift.id,
})
const summaryQris = transaction({
  id: 'summary-qris', createdAt: new Date(2026, 9, 26, 12, 30, 0).toISOString(), orderType: 'Dine in', paymentMethod: 'QRIS', subtotal: 10000, paidAmount: 10000, change: 0,
  items: [{ id: 'es-teh', name: 'Es Teh', category: 'Minuman', price: 10000, qty: 1 }], shiftId: summaryShift.id,
})
const summaryUnpaid = transaction({
  id: 'summary-unpaid', createdAt: new Date(2026, 9, 26, 12, 45, 0).toISOString(), orderType: 'GoFood', paymentMethod: 'Unpaid', subtotal: 15000, paidAmount: 0, change: 0,
  items: [{ id: 'dada', name: 'Ayam Dada + Nasi', category: 'Paket', price: 15000, qty: 1 }], shiftId: summaryShift.id,
})
const summaryPrevious = transaction({
  id: 'summary-prev', createdAt: new Date(2026, 9, 19, 11, 0, 0).toISOString(), paymentMethod: 'QRIS', subtotal: 20000, paidAmount: 20000, change: 0,
  items: [{ id: 'dada', name: 'Ayam Dada + Nasi', category: 'Paket', price: 20000, qty: 1 }], shiftId: summaryShift.id,
})
const summaryOutside = transaction({ id: 'summary-old', createdAt: new Date(2026, 8, 1, 11, 0, 0).toISOString(), subtotal: 50000, paidAmount: 50000, change: 0 })
const summaryCancelled = transaction({ id: 'summary-void', createdAt: new Date(2026, 9, 26, 15, 0, 0).toISOString(), subtotal: 40000, paidAmount: 40000, change: 0, status: 'cancelled' })
const summaryStore: PosStore = {
  ...baseStore,
  transactions: [summaryCash, summaryQris, summaryUnpaid, summaryPrevious, summaryOutside, summaryCancelled],
  shifts: [summaryShift],
  expenses: [{ id: 'exp-summary', createdAt: new Date(2026, 9, 26, 13, 0, 0).toISOString(), category: 'Lain-lain', amount: 5000, note: 'Gas' }],
  stockMovements: [{ id: 'opname-summary', createdAt: new Date(2026, 9, 26, 14, 0, 0).toISOString(), ingredientId: 'gula', type: 'opname', qty: -10, totalCost: -200, note: 'Opname', unitCost: 20 }],
}
const summaryRange = resolvePeriod('7d', summaryNow)
check('periode 7 hari mencakup 7 hari kalender', summaryRange.days === 7, String(summaryRange.days))
check('periode 7 hari mulai awal hari keenam', summaryRange.start.getDate() === 20 && summaryRange.start.getHours() === 0, summaryRange.start.toString())
check('periode 7 hari berakhir akhir hari ini', summaryRange.end.getDate() === 26 && summaryRange.end.getHours() === 23, summaryRange.end.toString())
const summary = buildOverviewSummary(summaryStore, summaryRange)
const summaryCogs = cogsForTransactions([summaryCash, summaryQris, summaryUnpaid], seedMenus, seedIngredients)
check('ringkasan hanya menghitung transaksi selesai dalam periode', summary.metrics.transactions === 3 && summary.metrics.revenue === 55000, JSON.stringify({ transactions: summary.metrics.transactions, revenue: summary.metrics.revenue }))
check('ringkasan menghitung item terjual', summary.metrics.items === 4, String(summary.metrics.items))
check('ringkasan menghitung rata-rata transaksi', Math.abs(summary.metrics.averageTicket - 55000 / 3) < 0.01, String(summary.metrics.averageTicket))
check('ringkasan memakai HPP resep', Math.abs(summary.metrics.cogs - summaryCogs) < 0.01, JSON.stringify({ actual: summary.metrics.cogs, expected: summaryCogs }))
check('ringkasan menghitung beban periode', summary.metrics.expenses === 5000 && summary.metrics.expenseCount === 1, JSON.stringify({ expenses: summary.metrics.expenses, count: summary.metrics.expenseCount }))
check('ringkasan menghitung penyesuaian opname', summary.metrics.inventoryAdjustment === 200, String(summary.metrics.inventoryAdjustment))
check('laba bersih = laba kotor - beban - opname', Math.abs(summary.metrics.netProfit - (55000 - summaryCogs - 5000 - 200)) < 0.01, String(summary.metrics.netProfit))
check('komposisi pembayaran memisahkan cash, QRIS, dan belum terbayar', summary.metrics.cashReceived === 30000 && summary.metrics.qrisReceived === 10000 && summary.metrics.unpaid === 15000, JSON.stringify({ cash: summary.metrics.cashReceived, qris: summary.metrics.qrisReceived, unpaid: summary.metrics.unpaid }))
check('total komposisi pembayaran sama dengan penjualan', Math.abs(summary.payments.reduce((sum, slice) => sum + slice.value, 0) - 55000) < 0.01, JSON.stringify(summary.payments))
check('delta penjualan dibanding periode sebelumnya', summary.metrics.previousRevenue === 20000 && Math.abs((summary.metrics.revenueDelta ?? 0) - 175) < 0.01, JSON.stringify({ previous: summary.metrics.previousRevenue, delta: summary.metrics.revenueDelta }))
check('tren harian memiliki 7 titik dan titik terakhir berisi hari ini', summary.trend.length === 7 && summary.trend[6].revenue === 55000 && summary.trend[6].transactions === 3, JSON.stringify(summary.trend.slice(-2)))
check('kanal pesanan mengikuti tipe pesanan', summary.channels.some((row) => row.label === 'GoFood' && row.revenue === 15000) && summary.channels[0].label === 'Takeaway', JSON.stringify(summary.channels))
check('kategori teratas mengikuti item transaksi', summary.categories[0]?.label === 'Paket' && summary.categories[0]?.revenue === 45000, JSON.stringify(summary.categories))
check('jam tersibuk dihitung dari transaksi', summary.peakHour?.hour === 12 && summary.peakHour?.transactions === 2, JSON.stringify(summary.peakHour))
check('rata-rata harian membagi total dengan jumlah hari', Math.abs(summary.metrics.averageDailyRevenue - 55000 / 7) < 0.01, String(summary.metrics.averageDailyRevenue))

const singleDay = resolvePeriod('custom', summaryNow, '2026-10-26', '2026-10-26')
const singleDaySummary = buildOverviewSummary(summaryStore, singleDay)
check('periode kustom satu hari memakai tren per jam', singleDay.days === 1 && singleDaySummary.trend.length === 24, JSON.stringify({ days: singleDay.days, points: singleDaySummary.trend.length }))
check('periode kustom satu hari menghitung penjualan hari itu', singleDaySummary.metrics.revenue === 55000, String(singleDaySummary.metrics.revenue))
const reversedRange = resolvePeriod('custom', summaryNow, '2026-10-26', '2026-10-20')
check('rentang kustom terbalik dinormalkan', reversedRange.start.getDate() === 20 && reversedRange.end.getDate() === 26 && reversedRange.days === 7, reversedRange.label)
const monthRange = resolvePeriod('month', summaryNow)
check('periode bulan ini mulai tanggal 1', monthRange.start.getDate() === 1 && monthRange.start.getMonth() === 9, monthRange.start.toString())
const emptySummary = buildOverviewSummary({ ...summaryStore, transactions: [], expenses: [], stockMovements: [] }, resolvePeriod('today', summaryNow))
check('ringkasan kosong tidak menghasilkan NaN', emptySummary.metrics.revenue === 0 && Number.isFinite(emptySummary.metrics.averageTicket) && emptySummary.metrics.grossMargin === 0 && emptySummary.peakHour === null, JSON.stringify(emptySummary.metrics))
check('delta menangani periode kosong', percentDelta(0, 0) === 0 && percentDelta(1000, 0) === null, String(percentDelta(1000, 0)))

// ---- Bridge printer Bluetooth (BLE tiruan) ----
const containsSequence = (haystack: number[], needle: number[]) =>
  haystack.some((_, index) => needle.every((byte, offset) => haystack[index + offset] === byte))
const btWrites: number[][] = []
const btWrite = async (value: BufferSource) => { btWrites.push([...new Uint8Array(value as ArrayBuffer)]) }
const btCharacteristic = {
  properties: { write: true, writeWithoutResponse: true },
  writeValue: btWrite,
  writeValueWithoutResponse: btWrite,
}
const btGatt = {
  connected: false,
  connect: async () => { btGatt.connected = true; return btGatt },
  disconnect: () => { btGatt.connected = false },
  getPrimaryServices: async () => [{ getCharacteristics: async () => [btCharacteristic] }],
}
const btDevice = { id: 'bt-test', name: 'Thermal Test', gatt: btGatt, addEventListener: () => {} }
Object.defineProperty(globalThis.navigator, 'bluetooth', {
  value: { requestDevice: async () => btDevice, getDevices: async () => [btDevice] },
  configurable: true,
})
const pairedPrinter = await requestBluetoothPrinter()
check('printer Bluetooth BLE terpasang', pairedPrinter.name === 'Thermal Test' && isBluetoothPrinterConnected(), JSON.stringify(pairedPrinter))
const webStatus = getPrinterTransportStatus()
check('transport Web Bluetooth dipilih saat tersedia', webStatus.kind === 'web-bluetooth' && webStatus.connected && webStatus.canSend, JSON.stringify(webStatus))
await sendReceiptTextToBluetooth('TES PRINTER\n', 1)
const btBytes = btWrites.flat()
check('payload ESC/POS diawali inisialisasi', btBytes[0] === 0x1b && btBytes[1] === 0x40, JSON.stringify(btBytes.slice(0, 4)))
check('ukuran font normal mengirim mode default', containsSequence(btBytes, [0x1b, 0x21, 0x00]), 'ESC ! 0x00')
check('payload memuat teks struk', Buffer.from(btBytes).toString('latin1').includes('TES PRINTER'))
check('payload diakhiri umpan & perintah potong', btBytes.slice(-7).join(',') === '10,10,10,10,29,86,0', JSON.stringify(btBytes.slice(-7)))
const btOutcome = await printReceiptPreferred(cashSale, { businessName: 'BT TEST', copies: 2 })
check('cetak memakai Bluetooth saat terhubung', btOutcome.mode === 'bluetooth', JSON.stringify(btOutcome))
const allBtBytes = btWrites.flat()
const cutCount = allBtBytes.filter((byte, index) => byte === 0x1d && allBtBytes[index + 1] === 0x56 && allBtBytes[index + 2] === 0x00).length
check('dua salinan mengirim dua perintah potong', cutCount === 3, String(cutCount))
await printReceiptPreferred(cashSale, { businessName: 'BT FONT', copies: 1, fontSize: 'compact' })
check('ukuran font compact ikut terkirim ke printer thermal', containsSequence(btWrites.flat(), [0x1b, 0x21, 0x01]), 'ESC ! 0x01')
disconnectBluetoothPrinter()
check('printer Bluetooth bisa diputuskan', !isBluetoothPrinterConnected())

// ---- Bridge native (BLE/Classic tiruan) ----
let nativeConnected = false
const nativePayloads: string[] = []
const nativeBridge = {
  getStatus: () => ({ connected: nativeConnected, deviceName: 'Native Thermal', transport: 'classic' as const }),
  pair: async () => { nativeConnected = true; return { deviceName: 'Native Thermal', transport: 'classic' as const } },
  reconnect: async () => { nativeConnected = true; return { deviceName: 'Native Thermal', transport: 'classic' as const } },
  disconnect: () => { nativeConnected = false },
  sendReceipt: async (input: { payloads: string[]; copies: number }) => {
    // Meniru bridge Android: setiap kirim memastikan koneksi ke printer tersimpan.
    nativeConnected = true
    nativePayloads.push(...input.payloads)
  },
}
;(window as unknown as { SabanaPrinter?: typeof nativeBridge }).SabanaPrinter = nativeBridge
const nativeStatus = getPrinterTransportStatus()
check('transport native diprioritaskan saat bridge tersedia', nativeStatus.kind === 'native' && nativeStatus.label.includes('Native') && nativeStatus.canPair && !nativeStatus.canSend, JSON.stringify(nativeStatus))
const nativePair = await pairWithActiveTransport()
check('pairing memakai bridge native', nativePair.kind === 'native' && nativeConnected, JSON.stringify(nativePair))
const nativeReady = getPrinterTransportStatus()
check('status native terhubung & memakai Classic', nativeReady.connected && nativeReady.canSend && nativeReady.label.includes('Classic'), JSON.stringify(nativeReady))
const nativeOutcome = await printReceiptPreferred(cashSale, { businessName: 'NATIVE TEST', copies: 2 })
check('cetak memakai transport native', nativeOutcome.mode === 'native', JSON.stringify(nativeOutcome))
check('native menerima dua payload ESC/POS', nativePayloads.length === 2, String(nativePayloads.length))
const nativeBytes = Uint8Array.from(Buffer.from(nativePayloads[0] ?? '', 'base64'))
check('payload native diawali inisialisasi', nativeBytes[0] === 0x1b && nativeBytes[1] === 0x40, JSON.stringify([...nativeBytes.slice(0, 4)]))
check('payload native memuat teks struk', Buffer.from(nativeBytes).toString('latin1').includes('NATIVE TEST'))
check('payload native memuat umpan kertas', [...nativeBytes.slice(-7, -3)].join(',') === '10,10,10,10', JSON.stringify([...nativeBytes.slice(-7, -3)]))
check('payload native diakhiri perintah potong', [...nativeBytes.slice(-3)].join(',') === '29,86,0', JSON.stringify([...nativeBytes.slice(-3)]))
await sendWithActiveTransport('NATIVE DIRECT', 1)
const nativeDirect = Uint8Array.from(Buffer.from(nativePayloads[2] ?? '', 'base64'))
check('pengiriman langsung memakai payload bersama', Buffer.from(nativeDirect).toString('latin1').includes('NATIVE DIRECT'), String(nativePayloads.length))
await printReceiptPreferred(cashSale, { businessName: 'NATIVE FONT', copies: 1, fontSize: 'large' })
const largeNative = Uint8Array.from(Buffer.from(nativePayloads[nativePayloads.length - 1] ?? '', 'base64'))
check('ukuran font besar ikut terkirim ke printer native', containsSequence([...largeNative], [0x1b, 0x21, 0x10]), 'ESC ! 0x10')
await disconnectActivePrinter()
check('printer native bisa diputuskan', !getPrinterTransportStatus().canSend)
const reconnectOutcome = await printReceiptPreferred(cashSale, { businessName: 'NATIVE AUTO RECONNECT', copies: 1 })
check('cetak native tetap dicoba saat status terputus (auto-reconnect)', reconnectOutcome.mode === 'native' && nativeConnected, JSON.stringify(reconnectOutcome))

if (failures > 0) {
  console.error(`${failures} pemeriksaan gagal`)
  process.exit(1)
}
console.log('Semua pemeriksaan domain lolos')
