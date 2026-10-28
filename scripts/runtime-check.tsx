/**
 * Runtime check: mount the real App in jsdom with a legacy localStorage payload,
 * then drive the owner screens and verify catalog, images, and settings.
 */
import { JSDOM } from 'jsdom'

import { SCHEMA_VERSION } from '../src/domain/pos'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:3000', pretendToBeVisual: true })
const { window } = dom

Object.defineProperty(globalThis, 'window', { value: window, configurable: true })
Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true })
Object.defineProperty(globalThis, 'HTMLElement', { value: window.HTMLElement, configurable: true })
Object.defineProperty(globalThis, 'HTMLInputElement', { value: window.HTMLInputElement, configurable: true })
Object.defineProperty(globalThis, 'Event', { value: window.Event, configurable: true })
Object.defineProperty(globalThis, 'MouseEvent', { value: window.MouseEvent, configurable: true })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })

const legacyPayload = {
  transactions: [
    {
      id: 'old-tx-1', number: 'POS-101', createdAt: '2026-10-01T10:00:00.000Z', orderType: 'Takeaway',
      paymentMethod: 'Cash', items: [{ id: 'dada', name: 'Ayam Dada + Nasi', category: 'Paket', price: 15000, qty: 1 }],
      subtotal: 15000, status: 'completed', shiftId: 'shift-old',
    },
    {
      id: 'today-tx-1', number: 'POS-202', createdAt: new Date().toISOString(), orderType: 'Dine in',
      paymentMethod: 'QRIS', items: [{ id: 'dada', name: 'Ayam Dada + Nasi', category: 'Paket', price: 15000, qty: 2 }],
      subtotal: 30000, paidAmount: 30000, change: 0, status: 'completed', shiftId: 'shift-old',
    },
  ],
  cashMovements: [{ id: 'old-in', createdAt: '2026-10-01T09:00:00.000Z', type: 'in', amount: 20000, note: 'Kas tambahan', shiftId: 'shift-old' }],
  shifts: [{ id: 'shift-old', openedAt: '2026-10-01T08:00:00.000Z', status: 'open' }],
}
window.localStorage.setItem('sabana-pos-store-v1', JSON.stringify(legacyPayload))

const errors: string[] = []
const originalError = console.error
console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); originalError(...args) }

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`PASS ${name}`)
  else { failures += 1; console.error(`FAIL ${name} ${detail}`) }
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { App } = await import('../src/App')

const container = window.document.getElementById('root')!
const root = createRoot(container)
await act(async () => { root.render(<App />) })

const bodyText = () => window.document.body.textContent ?? ''
const clickByLabel = (label: string) => {
  const target = window.document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null
  if (!target) throw new Error(`Tombol dengan aria-label "${label}" tidak ditemukan`)
  act(() => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
}
const clickByText = (label: string) => {
  const target = [...window.document.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)
  if (!target) throw new Error(`Tombol "${label}" tidak ditemukan`)
  act(() => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
}
const setInput = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}
const setSelect = (select: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
}
const fieldByLabel = (scope: ParentNode | null | undefined, label: string) => [...(scope?.querySelectorAll('.owner-field') ?? [])].find((field) => field.querySelector('span')?.textContent?.trim() === label)
const persistedState = () => JSON.parse(window.localStorage.getItem('sabana-pos-store-v1') ?? '{}')
const settle = async (ms = 25) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
const clickInDialog = (label: string) => {
  const dialog = window.document.querySelector('.owner-confirm')
  const target = [...(dialog?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === label)
  if (!target) throw new Error(`Tombol "${label}" tidak ada di dialog konfirmasi`)
  act(() => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
}
const clickByTextAsync = async (label: string) => {
  const target = [...window.document.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)
  if (!target) throw new Error(`Tombol "${label}" tidak ditemukan`)
  await act(async () => {
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
}
let ownerPin = '1234'
let recoveryCode = ''
const setupOwnerPin = async () => {
  const newPin = window.document.querySelector('[aria-label="PIN baru"]') as HTMLInputElement | null
  const confirmPin = window.document.querySelector('[aria-label="Ulangi PIN"]') as HTMLInputElement | null
  check('form membuat PIN tampil', Boolean(newPin && confirmPin))
  if (newPin) setInput(newPin, ownerPin)
  if (confirmPin) setInput(confirmPin, ownerPin)
  await clickByTextAsync('Buat PIN')
  const code = window.document.querySelector('[data-recovery-code]')
  check('kode pemulihan ditampilkan sekali', Boolean(code))
  recoveryCode = code?.getAttribute('data-recovery-code') ?? ''
  await clickByTextAsync('Saya sudah menyimpan kode')
  await settle(10)
}
const enterOwner = async (label = 'Buka mode pemilik') => {
  clickByLabel(label)
  await settle(10)
  const pinInput = window.document.querySelector('input[aria-label="PIN pemilik"]') as HTMLInputElement | null
  if (!pinInput) return
  setInput(pinInput, ownerPin)
  await clickByTextAsync('Buka')
  await settle(10)
}

check('aplikasi ter-mount tanpa error', bodyText().includes('Sabana POS'))
check('katalog seed muncul di POS setelah migrasi', bodyText().includes('Ayam Dada + Nasi'))
check('menu POS tidak kosong', window.document.querySelectorAll('.menu-card').length > 0, String(window.document.querySelectorAll('.menu-card').length))
check('kategori dinamis tampil di kasir', bodyText().includes('Minuman'))
check('gambar menu tampil di kartu kasir', Boolean(window.document.querySelector('.menu-card .menu-image')), 'tidak ada .menu-image')
check('gambar menu memakai aset lokal', (window.document.querySelector('.menu-card .menu-image') as HTMLImageElement | null)?.getAttribute('src')?.startsWith('/menu/'), String((window.document.querySelector('.menu-card .menu-image') as HTMLImageElement | null)?.getAttribute('src')))

clickByLabel('Riwayat transaksi')
check('transaksi lama tampil di riwayat', bodyText().includes('POS-101'))
check('total transaksi lama valid (bukan NaN)', !bodyText().includes('NaN') && bodyText().includes('Rp15.000'))
clickByLabel('Riwayat transaksi')

clickByLabel('Gunakan tema gelap')
check('tema gelap tersimpan ke pengaturan', persistedState().settings?.theme === 'dark', String(persistedState().settings?.theme))
clickByLabel('Gunakan tema terang')
check('tema terang kembali tersimpan', persistedState().settings?.theme === 'light', String(persistedState().settings?.theme))

clickByLabel('Buka mode pemilik')
await settle(10)
check('mode pemilik meminta PIN sebelum dibuka', Boolean(window.document.querySelector('.pin-modal')))
check('PIN pemilik belum tersimpan saat dialog pertama dibuka', !persistedState().settings?.ownerPin)
await setupOwnerPin()
check('layar pemilik terbuka setelah PIN dibuat', bodyText().includes('Mode pemilik'))
check('PIN tersimpan sebagai hash, bukan plaintext', persistedState().settings?.ownerPin?.hash !== ownerPin && /^[a-f0-9]{64}$/.test(persistedState().settings?.ownerPin?.hash ?? ''), JSON.stringify(persistedState().settings?.ownerPin))
check('kode pemulihan tidak disimpan sebagai plaintext', Boolean(recoveryCode) && !JSON.stringify(persistedState()).includes(recoveryCode.replace(/-/g, '')))
check('navigasi pemilik memiliki tab kategori & pengaturan', bodyText().includes('Kategori') && bodyText().includes('Pengaturan'))
const ownerStatsText = () => window.document.querySelector('.owner-stats')?.textContent ?? ''
check('filter periode ringkasan tersedia', window.document.querySelectorAll('.owner-period-tab').length === 5, String(window.document.querySelectorAll('.owner-period-tab').length))
check('ringkasan default hari ini menghitung penjualan', ownerStatsText().includes('Rp30.000'), ownerStatsText().slice(0, 220))
const trendSvg = window.document.querySelector('svg.owner-trend')
check('grafik tren penjualan tampil', Boolean(trendSvg))
check('grafik tren punya titik data per jam', trendSvg?.querySelectorAll('.owner-trend-dot').length === 24, String(trendSvg?.querySelectorAll('.owner-trend-dot').length))
const donut = window.document.querySelector('.owner-donut') as HTMLElement | null
check('donut pembayaran dinamis tampil', Boolean(donut?.style.background?.includes('conic-gradient')), donut?.style.background ?? 'tidak ada')
check('panel kanal, kategori, dan jam tampil', bodyText().includes('Kanal pesanan') && bodyText().includes('Kategori teratas') && bodyText().includes('Pola jam pesanan'))
clickByLabel('Periode 7 hari')
check('filter 7 hari aktif', window.document.querySelector('[aria-label="Periode 7 hari"]')?.getAttribute('aria-pressed') === 'true')
clickByLabel('Periode Kustom')
const customStartInput = window.document.querySelector('[aria-label="Tanggal mulai ringkasan"]') as HTMLInputElement | null
const customEndInput = window.document.querySelector('[aria-label="Tanggal akhir ringkasan"]') as HTMLInputElement | null
check('input rentang kustom tersedia', Boolean(customStartInput && customEndInput))
if (customStartInput) setInput(customStartInput, '2026-10-01')
if (customEndInput) setInput(customEndInput, '2026-10-01')
check('visual dan metrik mengikuti rentang kustom', ownerStatsText().includes('Rp15.000'), ownerStatsText().slice(0, 220))
check('grafik tetap tampil pada rentang kustom', Boolean(window.document.querySelector('svg.owner-trend')))
clickByText('Menu & HPP')
check('tab menu & HPP tampil', bodyText().includes('HPP dihitung otomatis'))

const dadaCard = [...window.document.querySelectorAll('.owner-menu-card')].find((card) => card.textContent?.includes('Ayam Dada + Nasi'))
check('kartu menu dada ditemukan', Boolean(dadaCard))
check('kartu menu menampilkan foto', Boolean(dadaCard?.querySelector('img.menu-image')))
const editButton = [...(dadaCard?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Edit')
check('tombol edit menu tersedia', Boolean(editButton))
if (editButton) act(() => { editButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })

const editor = window.document.querySelector('.modal.editor')
check('editor menu terbuka', Boolean(editor))
const priceField = [...(editor?.querySelectorAll('.owner-field') ?? [])].find((field) => field.textContent?.includes('Harga jual'))
const priceInput = priceField?.querySelector('input') as HTMLInputElement | null
check('input harga menu tersedia', Boolean(priceInput))
if (priceInput) {
  setInput(priceInput, '21000')
  check('harga berubah di editor', priceInput.value === '21000', priceInput.value)
}
const recipeRows = editor?.querySelectorAll('.recipe-row').length ?? 0
check('editor menampilkan resep bahan', recipeRows > 0, String(recipeRows))
const saveMenu = [...(editor?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Simpan perubahan')
if (saveMenu) act(() => { saveMenu.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('editor tertutup setelah simpan', !window.document.querySelector('.modal.editor'))
check('notifikasi perubahan menu tampil', bodyText().includes('diperbarui'))

clickByText('Pengaturan')
check('tab pengaturan terbuka', bodyText().includes('Printer & struk'))
check('pengaturan printer 58/80 mm tersedia', bodyText().includes('58 mm') && bodyText().includes('80 mm'))
check('pengaturan tata letak struk tersedia', bodyText().includes('Tata letak struk') && Boolean(window.document.querySelector('[aria-label="Header struk tengah"]')))
check('panel menampilkan transport sistem', bodyText().includes('Transport aktif: Dialog cetak sistem'), bodyText().slice(0, 300))
check('diagnostik pairing jelas saat tanpa bridge', bodyText().includes('Pairing tidak tersedia'), bodyText().slice(0, 300))
const pairButton = [...window.document.querySelectorAll('button')].find((button) => button.textContent?.includes('Cari & pasangkan'))
const reconnectButton = [...window.document.querySelectorAll('button')].find((button) => button.textContent?.includes('Hubungkan ulang'))
check('pairing dinonaktifkan saat transport sistem', Boolean(pairButton?.hasAttribute('disabled')), pairButton?.outerHTML.slice(0, 120) ?? 'tombol tidak ada')
check('reconnect dinonaktifkan saat transport sistem', Boolean(reconnectButton?.hasAttribute('disabled')), reconnectButton?.outerHTML.slice(0, 120) ?? 'tombol tidak ada')
clickByLabel('Header struk tengah')
clickByLabel('Footer struk tengah')
clickByLabel('Font struk besar')
clickByLabel('Cetak 2 salinan')
check('pratinjau mengikuti tata letak & salinan', bodyText().includes('Pratinjau 58 mm • 2 salinan'), bodyText().slice(0, 200))
const outletField = [...window.document.querySelectorAll('.owner-field')].find((field) => field.textContent?.includes('Nama outlet'))
const outletInput = outletField?.querySelector('input') as HTMLInputElement | null
check('input nama outlet tersedia', Boolean(outletInput))
if (outletInput) setInput(outletInput, 'Cabang Uji')
const footerField = [...window.document.querySelectorAll('.owner-field')].find((field) => field.textContent?.includes('Catatan kaki struk'))
const footerInput = footerField?.querySelector('textarea') as HTMLTextAreaElement | null
check('input footer struk tersedia', Boolean(footerInput))
if (footerInput) setInput(footerInput, 'WA 0812-3456')
const autoPrintButton = [...window.document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Tidak cetak otomatis')
check('toggle auto print tersedia', Boolean(autoPrintButton))
if (autoPrintButton) act(() => { autoPrintButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
clickByText('Simpan pengaturan')
check('pengaturan outlet tersimpan', persistedState().settings?.outletName === 'Cabang Uji', String(persistedState().settings?.outletName))
check('footer struk tersimpan', persistedState().settings?.receiptFooter === 'WA 0812-3456', String(persistedState().settings?.receiptFooter))
check('auto print tersimpan', persistedState().settings?.printer?.autoPrint === true, JSON.stringify(persistedState().settings?.printer))
check('tata letak printer tersimpan', persistedState().settings?.printer?.headerAlign === 'center' && persistedState().settings?.printer?.footerAlign === 'center' && persistedState().settings?.printer?.fontSize === 'large' && persistedState().settings?.printer?.copies === 2, JSON.stringify(persistedState().settings?.printer))
check('header pemilik memakai outlet baru', bodyText().includes('Cabang Uji'))

clickByText('Kasir')
check('kembali ke POS', bodyText().includes('Keranjang'))
check('topbar memakai outlet dari pengaturan', bodyText().includes('Cabang Uji'))
const updatedCard = [...window.document.querySelectorAll('.menu-card')].find((card) => card.textContent?.includes('Ayam Dada + Nasi'))
check('harga baru tercermin di katalog POS', Boolean(updatedCard?.textContent?.includes('Rp21.000')), updatedCard?.textContent ?? 'kartu tidak ada')
check('gambar tetap tampil di katalog POS', Boolean(updatedCard?.querySelector('img.menu-image')))

// ---- CRUD kategori, menu, bahan, dan pembelian massal ----
await enterOwner()
clickByText('Kategori')
const categoryInput = window.document.querySelector('[aria-label="Nama kategori baru"]') as HTMLInputElement | null
check('form kategori baru tersedia', Boolean(categoryInput))
if (categoryInput) setInput(categoryInput, 'Minuman Dingin')
clickByText('Tambah kategori')
check('kategori baru tersimpan', Boolean(persistedState().categories?.find((category: { name: string }) => category.name === 'Minuman Dingin')))

const categoryRow = [...window.document.querySelectorAll('.owner-category-row')].find((row) => row.textContent?.includes('Minuman Dingin'))
const renameCategory = [...(categoryRow?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Ubah')
if (renameCategory) act(() => { renameCategory.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const categoryModal = window.document.querySelector('.owner-modal')
const renameInput = categoryModal?.querySelector('input') as HTMLInputElement | null
check('modal ubah kategori terbuka', Boolean(renameInput))
if (renameInput) setInput(renameInput, 'Minuman Segar')
const saveCategory = [...(categoryModal?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Simpan')
if (saveCategory) act(() => { saveCategory.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('kategori berhasil diubah', Boolean(persistedState().categories?.find((category: { name: string }) => category.name === 'Minuman Segar')))

// Kategori bahan dikelola terpisah dari kategori menu.
const ingredientCategoryInput = window.document.querySelector('[aria-label="Nama kategori bahan baru"]') as HTMLInputElement | null
check('form kategori bahan baru tersedia', Boolean(ingredientCategoryInput))
if (ingredientCategoryInput) setInput(ingredientCategoryInput, 'Bumbu Kering')
const ingredientCategoryPanel = ingredientCategoryInput?.closest('.owner-panel')
const addIngredientCategory = [...(ingredientCategoryPanel?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Tambah kategori')
if (addIngredientCategory) act(() => { addIngredientCategory.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('kategori bahan baru tersimpan', Boolean(persistedState().ingredientCategories?.find((category: { name: string }) => category.name === 'Bumbu Kering')))

const ingredientCategoryRow = [...window.document.querySelectorAll('.owner-category-row')].find((row) => row.textContent?.includes('Bumbu Kering'))
const renameIngredientCategory = [...(ingredientCategoryRow?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Ubah')
if (renameIngredientCategory) act(() => { renameIngredientCategory.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const ingredientCategoryModal = window.document.querySelector('.owner-modal')
const ingredientRenameInput = ingredientCategoryModal?.querySelector('input') as HTMLInputElement | null
check('modal ubah kategori bahan terbuka', Boolean(ingredientRenameInput))
if (ingredientRenameInput) setInput(ingredientRenameInput, 'Bumbu Dapur')
const saveIngredientCategory = [...(ingredientCategoryModal?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Simpan')
if (saveIngredientCategory) act(() => { saveIngredientCategory.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('kategori bahan berhasil diubah', Boolean(persistedState().ingredientCategories?.find((category: { name: string }) => category.name === 'Bumbu Dapur')))

clickByText('Menu & HPP')
clickByText('Menu baru')
const createEditor = window.document.querySelector('.modal.editor')
const createName = fieldByLabel(createEditor, 'Nama menu')?.querySelector('input') as HTMLInputElement | null
const createPrice = fieldByLabel(createEditor, 'Harga jual')?.querySelector('input') as HTMLInputElement | null
const createCategory = fieldByLabel(createEditor, 'Kategori')?.querySelector('select') as HTMLSelectElement | null
check('editor menu baru lengkap', Boolean(createName && createPrice && createCategory))
if (createName) setInput(createName, 'Es Lemon')
if (createPrice) setInput(createPrice, '9000')
if (createCategory) setSelect(createCategory, 'Minuman Segar')
const addMenu = [...(createEditor?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Tambah menu')
if (addMenu) act(() => { addMenu.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('menu baru muncul di kelola menu', Boolean([...window.document.querySelectorAll('.owner-menu-card')].find((card) => card.textContent?.includes('Es Lemon'))))
check('menu baru tersimpan dengan kategori baru', Boolean(persistedState().menus?.find((menu: { name: string; category: string }) => menu.name === 'Es Lemon' && menu.category === 'Minuman Segar')))

clickByText('Kasir')
const newCategoryTab = [...window.document.querySelectorAll('.category')].find((button) => button.textContent?.trim() === 'Minuman Segar')
check('kategori baru tampil sebagai tab kasir', Boolean(newCategoryTab))
if (newCategoryTab) act(() => { newCategoryTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const newMenuCard = [...window.document.querySelectorAll('.menu-card')].find((card) => card.textContent?.includes('Es Lemon'))
check('menu baru tampil di kasir pada kategorinya', Boolean(newMenuCard?.textContent?.includes('Rp9.000')), newMenuCard?.textContent ?? 'tidak ada')

await enterOwner()
clickByText('Menu & HPP')
const lemonCard = [...window.document.querySelectorAll('.owner-menu-card')].find((card) => card.textContent?.includes('Es Lemon'))
const lemonEdit = [...(lemonCard?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Edit')
if (lemonEdit) act(() => { lemonEdit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const lemonEditor = window.document.querySelector('.modal.editor')
const deleteMenu = [...(lemonEditor?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Hapus menu')
if (deleteMenu) act(() => { deleteMenu.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('hapus menu membuka dialog di aplikasi', Boolean(window.document.querySelector('.owner-confirm')), bodyText().slice(-200))
check('menu belum terhapus sebelum konfirmasi', Boolean(persistedState().menus?.find((menu: { name: string }) => menu.name === 'Es Lemon')))
clickInDialog('Batal')
check('batal menutup dialog tanpa menghapus menu', !window.document.querySelector('.owner-confirm') && Boolean(persistedState().menus?.find((menu: { name: string }) => menu.name === 'Es Lemon')))
const deleteMenuAgain = [...(window.document.querySelector('.modal.editor')?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Hapus menu')
if (deleteMenuAgain) act(() => { deleteMenuAgain.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
clickInDialog('Hapus dari katalog')
check('menu baru berhasil dihapus', !persistedState().menus?.some((menu: { name: string }) => menu.name === 'Es Lemon'))
check('kategori tetap ada setelah menu dihapus', Boolean(persistedState().categories?.find((category: { name: string }) => category.name === 'Minuman Segar')))

clickByText('Bahan & stok')
clickByText('Bahan baru')
const ingredientModal = window.document.querySelector('.owner-modal')
const ingredientFields: Record<string, HTMLInputElement | null> = {
  name: fieldByLabel(ingredientModal, 'Nama bahan')?.querySelector('input') ?? null,
  unit: fieldByLabel(ingredientModal, 'Satuan pakai')?.querySelector('input') ?? null,
  purchaseUnit: fieldByLabel(ingredientModal, 'Satuan pembelian')?.querySelector('input') ?? null,
  purchasePrice: fieldByLabel(ingredientModal, 'Harga beli')?.querySelector('input') ?? null,
  usage: fieldByLabel(ingredientModal, 'Isi per pembelian')?.querySelector('input') ?? null,
  minStock: fieldByLabel(ingredientModal, 'Stok minimum')?.querySelector('input') ?? null,
}
const ingredientCategorySelect = fieldByLabel(ingredientModal, 'Kategori bahan')?.querySelector('select') as HTMLSelectElement | null
check('editor bahan punya pilihan kategori', Boolean(ingredientCategorySelect))
check('form bahan baru lengkap', Object.values(ingredientFields).every(Boolean))
if (ingredientCategorySelect) setSelect(ingredientCategorySelect, 'Bumbu Dapur')
if (ingredientFields.name) setInput(ingredientFields.name, 'Gula aren')
if (ingredientFields.unit) setInput(ingredientFields.unit, 'gram')
if (ingredientFields.purchaseUnit) setInput(ingredientFields.purchaseUnit, 'pack 1 kg')
if (ingredientFields.purchasePrice) setInput(ingredientFields.purchasePrice, '20000')
if (ingredientFields.usage) setInput(ingredientFields.usage, '1000')
if (ingredientFields.minStock) setInput(ingredientFields.minStock, '500')
const addIngredient = [...(ingredientModal?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Tambah bahan')
if (addIngredient) act(() => { addIngredient.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const addedIngredient = persistedState().ingredients?.find((ingredient: { name: string }) => ingredient.name === 'Gula aren')
check('bahan baru tersimpan', Boolean(addedIngredient))
check('bahan baru memakai kategori bahan terpilih', addedIngredient?.category === 'Bumbu Dapur', String(addedIngredient?.category))
check('biaya satuan bahan baru dihitung otomatis', Math.abs((addedIngredient?.costPerUnit ?? 0) - 20) < 0.001, String(addedIngredient?.costPerUnit))
check('bahan baru tampil di tabel stok', bodyText().includes('Gula aren'))

const purchaseSelect = window.document.querySelector('.purchase-form select') as HTMLSelectElement | null
const purchaseQty = window.document.querySelector('.purchase-form input[type="number"]') as HTMLInputElement | null
const purchaseCost = window.document.querySelectorAll('.purchase-form input[type="number"]')[1] as HTMLInputElement | undefined
check('form pembelian massal tersedia', Boolean(purchaseSelect && purchaseQty && purchaseCost))
clickByText('Per pack')
if (purchaseSelect && addedIngredient) setSelect(purchaseSelect, addedIngredient.id)
if (purchaseQty) setInput(purchaseQty, '1')
check('biaya pack terisi otomatis', purchaseCost?.value === '20000', String(purchaseCost?.value))
const packHint = [...window.document.querySelectorAll('.owner-panel p.owner-muted')].find((hint) => hint.textContent?.includes('Hasil: 1000 gram'))
check('konversi pack ke satuan pakai tampil', Boolean(packHint), packHint?.textContent ?? 'hint tidak ada')
clickByText('Tambah baris')
clickByText('Per satuan')
const tepung = persistedState().ingredients?.find((ingredient: { id: string }) => ingredient.id === 'tepung-bumbu')
if (purchaseSelect && tepung) setSelect(purchaseSelect, tepung.id)
if (purchaseQty) setInput(purchaseQty, '500')
if (purchaseCost) setInput(purchaseCost, '12000')
clickByText('Tambah baris')
check('dua baris pembelian tersusun', bodyText().includes('Simpan 2 pembelian'))
const savePurchases = [...window.document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Simpan 2 pembelian')
if (savePurchases) act(() => { savePurchases.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const purchaseMovements = persistedState().stockMovements ?? []
check('pembelian massal tersimpan dua pergerakan', purchaseMovements.length === 2, String(purchaseMovements.length))
check('total biaya pembelian massal tersimpan', purchaseMovements.reduce((sum: number, movement: { totalCost: number }) => sum + movement.totalCost, 0) === 32000)
const packMovement = purchaseMovements.find((movement: { note: string }) => movement.note.includes('pack 1 kg'))
check('pembelian pack dikonversi ke 1000 gram', packMovement?.qty === 1000, String(packMovement?.qty))
check('biaya pack memakai harga kemasan', packMovement?.totalCost === 20000, String(packMovement?.totalCost))

// ---- Opname stok: tambah, edit, hapus ----
clickByText('Opname baru')
const opnameModal = window.document.querySelector('.owner-modal')
const opnameSelect = opnameModal?.querySelector('[aria-label="Bahan opname"]') as HTMLSelectElement | null
const opnameCounted = opnameModal?.querySelector('[aria-label="Stok fisik"]') as HTMLInputElement | null
check('form opname tersedia', Boolean(opnameSelect && opnameCounted))
if (opnameSelect && addedIngredient) setSelect(opnameSelect, addedIngredient.id)
const systemStat = [...(opnameModal?.querySelectorAll('.opname-stat strong') ?? [])][0]
check('stok sistem opname terisi', Boolean(systemStat?.textContent?.includes('1000')), systemStat?.textContent ?? '')
if (opnameCounted) setInput(opnameCounted, '950')
check('selisih opname dihitung', Boolean([...(opnameModal?.querySelectorAll('.opname-diff') ?? [])].find((element) => element.textContent?.includes('-50'))))
const opnameJournalHint = [...(opnameModal?.querySelectorAll('p.owner-muted') ?? [])].find((hint) => hint.textContent?.includes('Nilai penyesuaian Rp1.000'))
check('nilai jurnal opname tampil di editor', Boolean(opnameJournalHint), opnameJournalHint?.textContent ?? 'hint tidak ada')
const saveOpname = [...(opnameModal?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Simpan opname')
if (saveOpname) act(() => { saveOpname.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const savedOpname = persistedState().stockMovements?.find((movement: { type: string }) => movement.type === 'opname')
check('opname tersimpan dengan snapshot', savedOpname?.countedQty === 950 && savedOpname?.systemQty === 1000 && savedOpname?.qty === -50, JSON.stringify(savedOpname))
check('opname menyimpan biaya satuan snapshot', savedOpname?.unitCost === 20, JSON.stringify(savedOpname))
clickByText('Laporan')
check('laporan menampilkan selisih persediaan', bodyText().includes('Termasuk selisih persediaan') && bodyText().includes('Rp1.000'), bodyText().slice(0, 400))
clickByText('Bahan & stok')
const opnameRow = [...window.document.querySelectorAll('.owner-opname-row')].find((row) => row.textContent?.includes('Gula aren'))
check('opname tampil di riwayat', Boolean(opnameRow))
const editOpname = [...(opnameRow?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Edit')
if (editOpname) act(() => { editOpname.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const editOpnameModal = window.document.querySelector('.owner-modal')
const editCounted = editOpnameModal?.querySelector('[aria-label="Stok fisik"]') as HTMLInputElement | null
check('form edit opname memakai snapshot', editCounted?.value === '950', editCounted?.value ?? '')
if (editCounted) setInput(editCounted, '980')
const saveEditedOpname = [...(editOpnameModal?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Simpan perubahan')
if (saveEditedOpname) act(() => { saveEditedOpname.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const editedOpname = persistedState().stockMovements?.find((movement: { type: string }) => movement.type === 'opname')
check('opname bisa diedit', editedOpname?.countedQty === 980 && editedOpname?.qty === -20, JSON.stringify(editedOpname))
check('edit opname mempertahankan biaya snapshot', editedOpname?.unitCost === 20, JSON.stringify(editedOpname))
const reopenedOpnameRow = [...window.document.querySelectorAll('.owner-opname-row')].find((row) => row.textContent?.includes('Gula aren'))
const reopenOpnameEdit = [...(reopenedOpnameRow?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Edit')
if (reopenOpnameEdit) act(() => { reopenOpnameEdit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const removeOpnameFromEditor = [...(window.document.querySelector('.owner-modal')?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Hapus opname')
if (removeOpnameFromEditor) act(() => { removeOpnameFromEditor.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('hapus opname dari editor membuka dialog di aplikasi', Boolean(window.document.querySelector('.owner-confirm')), bodyText().slice(-200))
clickInDialog('Batal')
check('batal mempertahankan opname dan editor', Boolean(window.document.querySelector('.owner-confirm') === null) && Boolean(persistedState().stockMovements?.some((movement: { type: string }) => movement.type === 'opname')) && Boolean(window.document.querySelector('.owner-modal')))
clickByText('Batal')
const editedOpnameRow = [...window.document.querySelectorAll('.owner-opname-row')].find((row) => row.textContent?.includes('Gula aren'))
const deleteOpnameButton = [...(editedOpnameRow?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Hapus')
if (deleteOpnameButton) act(() => { deleteOpnameButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('hapus opname dari tabel membuka dialog di aplikasi', Boolean(window.document.querySelector('.owner-confirm')), bodyText().slice(-200))
check('opname belum terhapus sebelum konfirmasi', Boolean(persistedState().stockMovements?.some((movement: { type: string }) => movement.type === 'opname')))
clickInDialog('Hapus catatan opname')
check('opname bisa dihapus', !persistedState().stockMovements?.some((movement: { type: string }) => movement.type === 'opname'))
check('pembelian tetap utuh setelah opname dihapus', persistedState().stockMovements?.length === 2, String(persistedState().stockMovements?.length))

clickByText('Kategori')
const minumanRow = [...window.document.querySelectorAll('.owner-category-row')].find((row) => row.textContent?.includes('Minuman Segar'))
const deleteCategoryButton = [...(minumanRow?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Hapus')
if (deleteCategoryButton) act(() => { deleteCategoryButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('hapus kategori membuka dialog di aplikasi', Boolean(window.document.querySelector('.owner-confirm')), bodyText().slice(-200))
check('kategori belum terhapus sebelum konfirmasi', Boolean(persistedState().categories?.find((category: { name: string }) => category.name === 'Minuman Segar')))
clickInDialog('Batal')
check('batal mempertahankan kategori', Boolean(persistedState().categories?.find((category: { name: string }) => category.name === 'Minuman Segar')))
const deleteCategoryAgain = [...([...window.document.querySelectorAll('.owner-category-row')].find((row) => row.textContent?.includes('Minuman Segar'))?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Hapus')
if (deleteCategoryAgain) act(() => { deleteCategoryAgain.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
clickInDialog('Hapus kategori')
check('kategori bisa dihapus saat tidak dipakai', !persistedState().categories?.some((category: { name: string }) => category.name === 'Minuman Segar'))

clickByText('Bahan & stok')
const gulaRow = [...window.document.querySelectorAll('.owner-data tbody tr')].find((row) => row.textContent?.includes('Gula aren'))
const editIngredientButton = [...(gulaRow?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Edit')
if (editIngredientButton) act(() => { editIngredientButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const editIngredientModal = window.document.querySelector('.owner-modal')
const minStockInput = fieldByLabel(editIngredientModal, 'Stok minimum')?.querySelector('input') as HTMLInputElement | null
check('form edit bahan terbuka', Boolean(minStockInput))
if (minStockInput) setInput(minStockInput, '750')
const saveIngredientEdit = [...(editIngredientModal?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Simpan')
if (saveIngredientEdit) act(() => { saveIngredientEdit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('bahan bisa diedit', persistedState().ingredients?.find((ingredient: { name: string }) => ingredient.name === 'Gula aren')?.minStock === 750)

const categoryFilter = window.document.querySelector('[aria-label="Filter kategori bahan"]') as HTMLSelectElement | null
check('filter kategori bahan tersedia', Boolean(categoryFilter))
if (categoryFilter) setSelect(categoryFilter, 'Bumbu Dapur')
const filteredIngredientRows = [...window.document.querySelectorAll('.owner-data tbody tr')]
check('filter kategori bahan menyaring tabel', filteredIngredientRows.length === 1 && filteredIngredientRows[0].textContent?.includes('Gula aren') && filteredIngredientRows[0].textContent?.includes('Bumbu Dapur'), `${filteredIngredientRows.length} baris`)
if (categoryFilter) setSelect(categoryFilter, 'Semua')

const gulaRowAfterEdit = [...window.document.querySelectorAll('.owner-data tbody tr')].find((row) => row.textContent?.includes('Gula aren'))
const deleteIngredientButton = gulaRowAfterEdit?.querySelector('[aria-label="Hapus bahan Gula aren"]') as HTMLButtonElement | null
check('tombol hapus bahan tersedia di tabel', Boolean(deleteIngredientButton), gulaRowAfterEdit?.textContent?.slice(0, 120) ?? 'baris tidak ada')
if (deleteIngredientButton) act(() => { deleteIngredientButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('hapus bahan membuka dialog di aplikasi (bukan window.confirm)', Boolean(window.document.querySelector('.owner-confirm')), bodyText().slice(-240))
check('bahan belum terhapus sebelum dikonfirmasi', Boolean(persistedState().ingredients?.find((ingredient: { name: string }) => ingredient.name === 'Gula aren')))
clickByText('Hapus bahan')
check('bahan bisa dihapus dari tabel setelah konfirmasi', !persistedState().ingredients?.some((ingredient: { name: string }) => ingredient.name === 'Gula aren'))
check('dialog konfirmasi tertutup setelah hapus', !window.document.querySelector('.owner-confirm'))

// Bahan yang masih dipakai resep harus bisa dihapus lewat jalur eksplisit "lepas dari resep".
const dadaRecipeBefore = (persistedState().menus?.find((menu: { id: string }) => menu.id === 'dada')?.recipe ?? []).length
const bbqRow = [...window.document.querySelectorAll('.owner-data tbody tr')].find((row) => row.textContent?.includes('Saus BBQ'))
const deleteUsedIngredient = bbqRow?.querySelector('[aria-label="Hapus bahan Saus BBQ"]') as HTMLButtonElement | null
check('bahan yang dipakai resep punya tombol hapus aktif', Boolean(deleteUsedIngredient) && deleteUsedIngredient?.disabled === false)
if (deleteUsedIngredient) act(() => { deleteUsedIngredient.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const usedDialog = window.document.querySelector('.owner-confirm')
check('dialog menjelaskan bahan dipakai menu', Boolean(usedDialog?.textContent?.includes('dipakai 1 menu')) && Boolean(usedDialog?.textContent?.includes('Rice Bowl BBQ 650')), usedDialog?.textContent ?? 'dialog tidak ada')
check('tombol konfirmasi menghapus sekaligus melepas resep', Boolean([...window.document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Hapus & lepas dari resep')))
clickByText('Hapus & lepas dari resep')
const afterUsedDelete = persistedState()
check('bahan dipakai resep bisa dihapus', !afterUsedDelete.ingredients?.some((ingredient: { id: string }) => ingredient.id === 'saus-bbq'))
check('baris resep menu ikut dilepas', !afterUsedDelete.menus?.find((menu: { id: string }) => menu.id === 'bbq')?.recipe?.some((line: { ingredientId: string }) => line.ingredientId === 'saus-bbq'))
check('resep menu lain tidak berubah', (afterUsedDelete.menus?.find((menu: { id: string }) => menu.id === 'dada')?.recipe ?? []).length === dadaRecipeBefore, `${dadaRecipeBefore} → ${(afterUsedDelete.menus?.find((menu: { id: string }) => menu.id === 'dada')?.recipe ?? []).length}`)

// ---- Gerbang PIN untuk pengaturan printer dan tutup shift ----
clickByText('Kasir')
clickByLabel('Pengaturan printer')
await settle(10)
check('pengaturan printer meminta PIN', Boolean(window.document.querySelector('.pin-modal')) && bodyText().includes('membuka pengaturan dan printer'), bodyText().slice(0, 160))
const printerPinInput = window.document.querySelector('input[aria-label="PIN pemilik"]') as HTMLInputElement | null
if (printerPinInput) setInput(printerPinInput, ownerPin)
await clickByTextAsync('Buka')
check('pengaturan terbuka setelah PIN benar', bodyText().includes('Printer & struk'))

clickByText('Kasir')
clickByLabel('Menu')
clickByText('Tutup shift')
const actualCashInput = window.document.querySelector('input[placeholder="Uang fisik aktual"]') as HTMLInputElement | null
check('form tutup shift tersedia', Boolean(actualCashInput))
if (actualCashInput) setInput(actualCashInput, '385000')
await clickByTextAsync('Konfirmasi tutup shift')
check('tutup shift meminta PIN', Boolean(window.document.querySelector('.pin-modal')) && bodyText().includes('menutup shift'), bodyText().slice(0, 160))
clickByText('Batal')

const persisted = persistedState()
check('state tersimpan dengan versi skema terbaru', persisted.schemaVersion === SCHEMA_VERSION, String(persisted.schemaVersion))
check('metadata sync tersimpan di state', persisted.sync?.outletId === 'outlet-local' && typeof persisted.sync?.deviceId === 'string', JSON.stringify(persisted.sync))
check('harga baru tersimpan di localStorage', persisted.menus?.find((menu: { id: string }) => menu.id === 'dada')?.price === 21000)
check('kategori tersimpan di localStorage', Array.isArray(persisted.categories) && persisted.categories.length >= 5, String(persisted.categories?.length))
check('kategori bahan tersimpan di localStorage', Array.isArray(persisted.ingredientCategories) && persisted.ingredientCategories.some((category: { name: string }) => category.name === 'Bumbu Dapur'), String(persisted.ingredientCategories?.length))
check('bahan seed menyimpan kategori', persisted.ingredients?.find((ingredient: { id: string }) => ingredient.id === 'tepung-bumbu')?.category === 'Bumbu & saus', String(persisted.ingredients?.find((ingredient: { id: string }) => ingredient.id === 'tepung-bumbu')?.category))
check('pengaturan printer tersimpan', persisted.settings?.printer?.paperWidth === 58 && typeof persisted.settings?.businessName === 'string')
check('gambar menu tersimpan di katalog', Boolean(persisted.menus?.find((menu: { id: string }) => menu.id === 'dada')?.imageUrl))
check('audit log tercatat setelah ubah harga', Array.isArray(persisted.auditLog) && persisted.auditLog.length > 0)

// ---- Reset PIN dengan kode pemulihan ----
const closeShiftModal = window.document.querySelector('.modal.small .modal-close') as HTMLButtonElement | null
if (closeShiftModal) act(() => { closeShiftModal.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
clickByLabel('Buka mode pemilik')
await settle(10)
clickByText('Lupa PIN? Pulihkan dengan kode')
const recoveryInput = window.document.querySelector('input[aria-label="Kode pemulihan"]') as HTMLInputElement | null
const newPinInput = window.document.querySelector('input[aria-label="PIN baru"]') as HTMLInputElement | null
const confirmPinInput = window.document.querySelector('input[aria-label="Ulangi PIN"]') as HTMLInputElement | null
check('form pemulihan PIN tersedia', Boolean(recoveryInput && newPinInput && confirmPinInput) && Boolean(recoveryCode))
const oldPin = ownerPin
if (recoveryInput) setInput(recoveryInput, recoveryCode)
if (newPinInput) setInput(newPinInput, '5678')
if (confirmPinInput) setInput(confirmPinInput, '5678')
await clickByTextAsync('Pulihkan & buat PIN')
const newRecovery = window.document.querySelector('[data-recovery-code]')?.getAttribute('data-recovery-code') ?? ''
check('pemulihan menghasilkan kode pemulihan baru', Boolean(newRecovery) && newRecovery !== recoveryCode)
await clickByTextAsync('Saya sudah menyimpan kode')
check('mode pemilik terbuka setelah pemulihan', bodyText().includes('Mode pemilik'))
clickByText('Kasir')
clickByLabel('Buka mode pemilik')
await settle(10)
const retryPinInput = window.document.querySelector('input[aria-label="PIN pemilik"]') as HTMLInputElement | null
if (retryPinInput) setInput(retryPinInput, oldPin)
await clickByTextAsync('Buka')
check('PIN lama tidak berlaku setelah pemulihan', bodyText().includes('PIN salah'))
if (retryPinInput) setInput(retryPinInput, '5678')
await clickByTextAsync('Buka')
check('PIN baru berlaku setelah pemulihan', bodyText().includes('Mode pemilik'))
ownerPin = '5678'
clickByText('Kasir')

// ---- Kegagalan penyimpanan harus terlihat, bukan ditelan ----
const storagePrototype = Object.getPrototypeOf(window.localStorage) as unknown as { setItem: Storage['setItem'] }
const originalSetItem = storagePrototype.setItem
storagePrototype.setItem = () => { throw new DOMException('Kuota penyimpanan penuh', 'QuotaExceededError') }
clickByLabel('Gunakan tema gelap')
await settle(30)
check('kegagalan penyimpanan menampilkan alert terlihat', Boolean(window.document.querySelector('.storage-alert.danger')) && bodyText().includes('Penyimpanan perangkat penuh'), bodyText().slice(-300))
storagePrototype.setItem = originalSetItem
const retryStorage = [...window.document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Coba lagi')
if (retryStorage) await act(async () => { retryStorage.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 30)) })
check('alert hilang setelah penyimpanan berhasil', !window.document.querySelector('.storage-alert.danger'))

// ---- Restore: tolak file rusak, tampilkan pratinjau untuk file valid ----
await enterOwner()
clickByText('Backup')
check('tab backup terbuka', bodyText().includes('Backup & restore'))
await settle(40)
check('panel backup cloud tampil di tab backup', bodyText().includes('Backup cloud (Supabase)'))
check('panel cloud default nonaktif dengan transport jelas', bodyText().includes('Nonaktif') && bodyText().includes('Belum aktif'), bodyText().slice(-400))
check('form aktivasi cloud meminta URL, anon key, outlet, dan frasa sandi', ['URL project', 'Anon key', 'UUID outlet', 'Frasa sandi enkripsi'].every((label) => bodyText().includes(label)))
const cloudUrlInput = window.document.querySelector('input[placeholder="https://xxxx.supabase.co"]') as HTMLInputElement | null
check('form cloud tetap kosong tanpa env build', Boolean(cloudUrlInput) && cloudUrlInput.value === '')
check('panel cloud menegaskan kasir tetap lokal', bodyText().includes('Kasir tetap bekerja dari IndexedDB'))
check('tidak ada tombol backup cloud manual', !bodyText().includes('Backup sekarang ke cloud'))
check('panel cloud menjelaskan backup otomatis + percobaan ulang', bodyText().includes('Backup otomatis') && bodyText().includes('dibuat otomatis') && bodyText().includes('dicoba ulang'), bodyText().slice(-320))
check('panel sinkronisasi tampil di tab backup', bodyText().includes('Sinkronisasi katalog'))
check('panel sync menampilkan seq, pull terakhir, dan antrean', ['Seq terakhir', 'Pull terakhir', 'Perubahan tertunda'].every((label) => bodyText().includes(label)))
check('panel sync menjelaskan strategi konflik', bodyText().includes('Strategi konflik') && bodyText().includes('row_version'))
const syncButton = [...window.document.querySelectorAll('button')].find((button) => button.textContent?.includes('Sinkronkan sekarang'))
check('tombol Sinkronkan sekarang tersedia', Boolean(syncButton))
if (syncButton) {
  await act(async () => { syncButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 60)) })
  check('sync tanpa konfigurasi memberi petunjuk, bukan error', bodyText().includes('Aktifkan backup cloud terlebih dahulu'), bodyText().slice(-260))
}
const backupFileInput = window.document.querySelector('.owner-backup-actions input[type="file"]') as HTMLInputElement | null
check('input file restore tersedia', Boolean(backupFileInput))
if (backupFileInput) {
  const invalidFile = new window.File(['{rusak'], 'rusak.json', { type: 'application/json' })
  Object.defineProperty(backupFileInput, 'files', { value: [invalidFile], configurable: true })
  await act(async () => { backupFileInput.dispatchEvent(new window.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 40)) })
  check('file restore rusak ditolak tanpa mengubah data', bodyText().includes('Restore ditolak'))

  const { createBackupRecord, serializeBackup } = await import('../src/lib/backup')
  const validFile = new window.File([serializeBackup(createBackupRecord(persistedState(), 'manual'))], 'valid.json', { type: 'application/json' })
  Object.defineProperty(backupFileInput, 'files', { value: [validFile], configurable: true })
  await act(async () => { backupFileInput.dispatchEvent(new window.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 40)) })
  check('file restore valid menampilkan pratinjau sebelum menimpa', Boolean(window.document.querySelector('.restore-modal')) && bodyText().includes('Tinjau isi backup'))
  const originalWindowSetTimeout = window.setTimeout
  window.setTimeout = function (handler: TimerHandler, timeout?: number, ...args: unknown[]) {
    if (timeout === 80) return 0
    return originalWindowSetTimeout(handler, timeout, ...args)
  } as typeof window.setTimeout
  try {
    await clickByTextAsync('Timpa data & muat ulang')
    await settle(20)
  } finally {
    window.setTimeout = originalWindowSetTimeout
  }
  check('restore valid diterapkan setelah konfirmasi', !window.document.querySelector('.restore-modal') && persistedState().auditLog?.some((entry: { action: string }) => entry.action === 'restore'), bodyText().slice(-240))
}

// ---- Void transaksi juga wajib PIN ----
clickByText('Kasir')
clickByLabel('Riwayat transaksi')
const historyRow = window.document.querySelector('.history-row') as HTMLButtonElement | null
check('riwayat transaksi tersedia untuk uji void', Boolean(historyRow))
if (historyRow) act(() => { historyRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const receiptPreview = window.document.querySelector('.receipt')?.textContent ?? ''
check('struk riwayat memakai outlet dari pengaturan', receiptPreview.includes('Cabang Uji'), receiptPreview.slice(0, 180))
check('struk riwayat memakai footer dari pengaturan', receiptPreview.includes('WA 0812-3456'), receiptPreview.slice(-180))
const voidReasonInput = window.document.querySelector('.void-reason') as HTMLInputElement | null
if (voidReasonInput) setInput(voidReasonInput, 'Salah input uji')
await clickByTextAsync('Void')
check('void transaksi meminta PIN', Boolean(window.document.querySelector('.pin-modal')) && bodyText().includes('void transaksi'), bodyText().slice(-180))
clickByText('Batal')
check('void bisa dibatalkan sebelum PIN', !window.document.querySelector('.pin-modal'))

check('tidak ada error React/konsol', errors.length === 0, errors.slice(0, 2).join(' | '))

await act(async () => { root.unmount() })

if (failures > 0) {
  console.error(`${failures} pemeriksaan runtime gagal`)
  process.exit(1)
}
console.log('Semua pemeriksaan runtime lolos')
