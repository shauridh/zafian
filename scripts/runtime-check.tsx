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
const enterOwner = async (label = 'Buka mode pemilik') => {
  clickByLabel(label)
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
check('mode pemilik terbuka langsung tanpa PIN', bodyText().includes('Mode pemilik') && !window.document.querySelector('.pin-modal'))
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

clickByText('Menu baru')
const newMenuEditor = window.document.querySelector('.modal.editor')
check('form menu baru menyediakan salin resep', Boolean(newMenuEditor?.querySelector('[aria-label="Menu sumber resep"]')))
const copySourceSelect = newMenuEditor?.querySelector('[aria-label="Menu sumber resep"]') as HTMLSelectElement | null
const copyFactorInput = newMenuEditor?.querySelector('[aria-label="Faktor porsi resep"]') as HTMLInputElement | null
if (copySourceSelect) {
  const dadaOption = [...copySourceSelect.options].find((option) => option.textContent?.includes('Ayam Dada + Nasi'))
  check('menu sumber resep tersedia di pilihan', Boolean(dadaOption))
  if (dadaOption) setSelect(copySourceSelect, dadaOption.value)
}
if (copyFactorInput) setInput(copyFactorInput, '2')
const copyRecipeButton = [...(newMenuEditor?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Salin resep')
if (copyRecipeButton) act(() => { copyRecipeButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const copiedRows = [...(newMenuEditor?.querySelectorAll('.recipe-row') ?? [])]
check('salin resep mengisi seluruh baris resep', copiedRows.length === 9, String(copiedRows.length))
const firstCopiedQty = copiedRows[0]?.querySelector('input[type="number"]') as HTMLInputElement | null
check('porsi salinan mengikuti faktor 2', firstCopiedQty?.value === '2', String(firstCopiedQty?.value))
check('catatan salin resep tampil', bodyText().includes('disalin (2× porsi)'), bodyText().slice(-160))
const cancelNewMenu = [...(newMenuEditor?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Batal')
if (cancelNewMenu) act(() => { cancelNewMenu.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('editor menu baru tertutup tanpa menyimpan', !window.document.querySelector('.modal.editor'))

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
const phoneField = [...window.document.querySelectorAll('.owner-field')].find((field) => field.textContent?.includes('Nomor telepon outlet'))
const phoneInput = phoneField?.querySelector('input') as HTMLInputElement | null
check('input nomor telepon outlet tersedia', Boolean(phoneInput))
if (phoneInput) setInput(phoneInput, '0812-9999-0000')
const footerField = [...window.document.querySelectorAll('.owner-field')].find((field) => field.textContent?.includes('Catatan kaki struk'))
const footerInput = footerField?.querySelector('textarea') as HTMLTextAreaElement | null
check('input footer struk tersedia', Boolean(footerInput))
if (footerInput) setInput(footerInput, 'WA 0812-3456')
const autoPrintButton = [...window.document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Tidak cetak otomatis')
check('toggle auto print tersedia', Boolean(autoPrintButton))
if (autoPrintButton) act(() => { autoPrintButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
clickByText('Simpan pengaturan')
check('pengaturan outlet tersimpan', persistedState().settings?.outletName === 'Cabang Uji', String(persistedState().settings?.outletName))
check('nomor telepon outlet tersimpan', persistedState().settings?.outletPhone === '0812-9999-0000', String(persistedState().settings?.outletPhone))
const settingsReceiptPreview = window.document.querySelector('.printer-preview')?.textContent ?? ''
check('nomor telepon tampil di bawah nama outlet pada struk', settingsReceiptPreview.indexOf('0812-9999-0000') > settingsReceiptPreview.indexOf('Cabang Uji'), settingsReceiptPreview.slice(0, 160))
check('footer struk tersimpan', persistedState().settings?.receiptFooter === 'WA 0812-3456', String(persistedState().settings?.receiptFooter))
check('auto print tersimpan', persistedState().settings?.printer?.autoPrint === true, JSON.stringify(persistedState().settings?.printer))
check('tata letak printer tersimpan', persistedState().settings?.printer?.headerAlign === 'center' && persistedState().settings?.printer?.footerAlign === 'center' && persistedState().settings?.printer?.fontSize === 'large' && persistedState().settings?.printer?.copies === 2, JSON.stringify(persistedState().settings?.printer))
check('header pemilik memakai outlet baru', bodyText().includes('Cabang Uji'))
check('nomor telepon tampil di bawah nama outlet', bodyText().includes('0812-9999-0000'))

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
const ingredientFields: Record<string, HTMLInputElement | HTMLSelectElement | null> = {
  name: fieldByLabel(ingredientModal, 'Nama bahan')?.querySelector('input') ?? null,
  unit: fieldByLabel(ingredientModal, 'Satuan pakai')?.querySelector('select') ?? null,
  purchaseUnit: fieldByLabel(ingredientModal, 'Satuan pembelian')?.querySelector('select') ?? null,
  purchasePrice: fieldByLabel(ingredientModal, 'Harga beli')?.querySelector('input') ?? null,
  usage: fieldByLabel(ingredientModal, 'Isi per pembelian')?.querySelector('input') ?? null,
  minStock: fieldByLabel(ingredientModal, 'Stok minimum')?.querySelector('input') ?? null,
  standardQty: fieldByLabel(ingredientModal, 'Pemakaian standar per porsi')?.querySelector('input') ?? null,
}
const ingredientUnitSelect = ingredientFields.unit as HTMLSelectElement | null
const ingredientPurchaseUnitSelect = ingredientFields.purchaseUnit as HTMLSelectElement | null
const ingredientCategorySelect = fieldByLabel(ingredientModal, 'Kategori bahan')?.querySelector('select') as HTMLSelectElement | null
check('editor bahan punya pilihan kategori', Boolean(ingredientCategorySelect))
check('form bahan baru lengkap', Object.values(ingredientFields).every(Boolean))
check('satuan pakai & pembelian memakai dropdown semua unit', Boolean(ingredientUnitSelect && ingredientPurchaseUnitSelect) && ingredientUnitSelect.options.length >= 20 && ingredientPurchaseUnitSelect.options.length >= 20, `${ingredientUnitSelect?.options.length ?? 0}/${ingredientPurchaseUnitSelect?.options.length ?? 0}`)
if (ingredientCategorySelect) setSelect(ingredientCategorySelect, 'Bumbu Dapur')
if (ingredientFields.name) setInput(ingredientFields.name, 'Gula aren')
if (ingredientUnitSelect) setSelect(ingredientUnitSelect, 'gram')
if (ingredientPurchaseUnitSelect) setSelect(ingredientPurchaseUnitSelect, 'pack')
if (ingredientFields.purchasePrice) setInput(ingredientFields.purchasePrice, '20000')
if (ingredientFields.usage) setInput(ingredientFields.usage, '1000')
if (ingredientFields.minStock) setInput(ingredientFields.minStock, '500')
if (ingredientFields.standardQty) setInput(ingredientFields.standardQty, '37')
const addIngredient = [...(ingredientModal?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Tambah bahan')
if (addIngredient) act(() => { addIngredient.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const addedIngredient = persistedState().ingredients?.find((ingredient: { name: string }) => ingredient.name === 'Gula aren')
check('bahan baru tersimpan', Boolean(addedIngredient))
check('bahan baru memakai kategori bahan terpilih', addedIngredient?.category === 'Bumbu Dapur', String(addedIngredient?.category))
check('biaya satuan bahan baru dihitung otomatis', Math.abs((addedIngredient?.costPerUnit ?? 0) - 20) < 0.001, String(addedIngredient?.costPerUnit))
check('bahan baru tampil di tabel stok', bodyText().includes('Gula aren'))
check('pemakaian standar bahan tersimpan di pengaturan', persistedState().settings?.ingredientUsage?.[addedIngredient?.id] === 37, JSON.stringify(persistedState().settings?.ingredientUsage))

clickByText('Atur standar')
const standardModal = window.document.querySelector('.modal')
check('dialog isi standar massal terbuka', Boolean(standardModal))
const standardGula = standardModal?.querySelector('[aria-label="Standar Gula aren"]') as HTMLInputElement | null
const standardTepung = standardModal?.querySelector('[aria-label="Standar Tepung bumbu"]') as HTMLInputElement | null
check('dialog standar menampilkan satu input per bahan', (standardModal?.querySelectorAll('[aria-label^="Standar "]').length ?? 0) >= 10, String(standardModal?.querySelectorAll('[aria-label^="Standar "]').length ?? 0))
check('nilai standar tersimpan terisi saat dialog dibuka', standardGula?.value === '37', String(standardGula?.value))
if (standardGula) setInput(standardGula, '45')
if (standardTepung) setInput(standardTepung, '42')
const saveStandards = [...(standardModal?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Simpan standar')
if (saveStandards) act(() => { saveStandards.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(20)
const bulkUsageState = persistedState().settings?.ingredientUsage ?? {}
check('beberapa standar tersimpan sekali simpan', bulkUsageState['tepung-bumbu'] === 42 && bulkUsageState[addedIngredient?.id] === 45, JSON.stringify(bulkUsageState))
check('dialog standar tertutup setelah simpan', !window.document.querySelector('.modal'))
clickByText('Atur standar')
const reopenedStandard = window.document.querySelector('.modal')
const reopenedTepung = reopenedStandard?.querySelector('[aria-label="Standar Tepung bumbu"]') as HTMLInputElement | null
check('dialog standar menampilkan nilai yang baru disimpan', reopenedTepung?.value === '42', String(reopenedTepung?.value))
const closeStandards = [...(reopenedStandard?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Batal')
if (closeStandards) act(() => { closeStandards.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('batal menutup dialog standar tanpa menyimpan', !window.document.querySelector('.modal'))

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
const packMovement = purchaseMovements.find((movement: { note: string }) => movement.note.includes('1 pack'))
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

// ---- Pengaturan printer dan rekonsiliasi tutup shift ----
clickByText('Kasir')
clickByLabel('Pengaturan printer')
await settle(10)
check('pengaturan printer terbuka langsung tanpa PIN', bodyText().includes('Printer & struk') && !window.document.querySelector('.pin-modal'))
check('panduan pairing RPP02N tampil di pengaturan', bodyText().includes('Panduan pairing RPP02N'), bodyText().slice(0, 200))
check('instruksi install PWA di Chrome tampil', bodyText().includes('Cara install di Chrome') && bodyText().includes('Tambahkan ke layar utama'), bodyText().slice(0, 200))

clickByText('Kasir')
clickByLabel('Menu')
clickByText('Tutup shift')
const actualCashInput = window.document.querySelector('input[placeholder="Uang fisik aktual"]') as HTMLInputElement | null
check('form tutup shift tersedia', Boolean(actualCashInput))
if (actualCashInput) setInput(actualCashInput, '385000')
const floatRowText = [...window.document.querySelectorAll('.summary-row')].find((row) => row.textContent?.includes('Float awal'))?.querySelector('b')?.textContent ?? ''
const floatValue = Number(floatRowText.replace(/[^0-9-]/g, ''))
const handoverValue = () => Number((window.document.querySelector('.handover-row b')?.textContent ?? '').replace(/[^0-9-]/g, ''))
check('rekonsiliasi menampilkan setoran ke owner', Boolean(window.document.querySelector('.handover-row')), bodyText().slice(0, 200))
check('setoran ke owner = kas fisik − float awal', handoverValue() === 385000 - floatValue, `${window.document.querySelector('.handover-row b')?.textContent} vs float ${floatRowText}`)
if (actualCashInput) setInput(actualCashInput, '100000')
check('kas fisik di bawah float tidak menghasilkan setoran negatif', handoverValue() === 0, String(handoverValue()))
check('kekurangan kas terhadap float dijelaskan apa adanya', bodyText().includes('tidak ada setoran ke owner') && bodyText().includes('kurang'), bodyText().slice(0, 220))
if (actualCashInput) setInput(actualCashInput, '385000')
const closeShiftModal = window.document.querySelector('.modal.small .modal-close') as HTMLButtonElement | null
if (closeShiftModal) act(() => { closeShiftModal.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })

const persisted = persistedState()
check('state tersimpan dengan versi skema terbaru', persisted.schemaVersion === SCHEMA_VERSION, String(persisted.schemaVersion))
check('harga baru tersimpan di localStorage', persisted.menus?.find((menu: { id: string }) => menu.id === 'dada')?.price === 21000)
check('kategori tersimpan di localStorage', Array.isArray(persisted.categories) && persisted.categories.length >= 5, String(persisted.categories?.length))
check('kategori bahan tersimpan di localStorage', Array.isArray(persisted.ingredientCategories) && persisted.ingredientCategories.some((category: { name: string }) => category.name === 'Bumbu Dapur'), String(persisted.ingredientCategories?.length))
check('bahan seed menyimpan kategori', persisted.ingredients?.find((ingredient: { id: string }) => ingredient.id === 'tepung-bumbu')?.category === 'Bumbu & saus', String(persisted.ingredients?.find((ingredient: { id: string }) => ingredient.id === 'tepung-bumbu')?.category))
check('pengaturan printer tersimpan', persisted.settings?.printer?.paperWidth === 58 && typeof persisted.settings?.businessName === 'string')
check('gambar menu tersimpan di katalog', Boolean(persisted.menus?.find((menu: { id: string }) => menu.id === 'dada')?.imageUrl))
check('audit log tercatat setelah ubah harga', Array.isArray(persisted.auditLog) && persisted.auditLog.length > 0)

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
const voidedRuntime = (persistedState().transactions ?? []).find((transaction: { statusReason?: string }) => transaction.statusReason === 'Salah input uji')
check('void tanpa dialog PIN', !window.document.querySelector('.pin-modal'))
check('void langsung tersimpan setelah alasan diisi', voidedRuntime?.status === 'cancelled', JSON.stringify(voidedRuntime?.status ?? null))

// ---- Jembatan printer native: callback Android menjadi Promise ----
const { installNativePrinterShim, uninstallNativePrinterShim } = await import('../src/lib/native-printer-shim')
const nativeCalls: Array<{ method: string; args: string[] }> = []
const fakeNative = {
  getStatus: () => JSON.stringify({ connected: true, deviceName: 'RPP02N', transport: 'classic' }),
  requestPair: (id: string) => { nativeCalls.push({ method: 'pair', args: [id] }) },
  requestReconnect: (id: string, name: string) => { nativeCalls.push({ method: 'reconnect', args: [id, name] }) },
  requestDisconnect: (id: string) => { nativeCalls.push({ method: 'disconnect', args: [id] }) },
  requestSendReceipt: (id: string, input: string) => { nativeCalls.push({ method: 'sendReceipt', args: [id, input] }) },
}
const nativeWindow = window as unknown as {
  SabanaNative?: typeof fakeNative
  SabanaPrinter?: {
    getStatus: () => { connected: boolean; deviceName?: string | null }
    pair: () => Promise<{ deviceName: string }>
    sendReceipt: (input: { payloads: string[]; copies: number }) => Promise<void>
  }
  __sabanaNativeResolve?: (id: string, payload: string) => void
}
nativeWindow.SabanaNative = fakeNative
check('shim printer native terpasang saat bridge Android tersedia', installNativePrinterShim() && Boolean(nativeWindow.SabanaPrinter))
const nativeBridge = nativeWindow.SabanaPrinter
check('status printer native terbaca oleh aplikasi', nativeBridge?.getStatus().connected === true && nativeBridge?.getStatus().deviceName === 'RPP02N', JSON.stringify(nativeBridge?.getStatus()))
const nativePair = nativeBridge?.pair()
const pairCall = nativeCalls.find((call) => call.method === 'pair')
check('pairing native memakai requestId', Boolean(pairCall?.args[0]))
if (pairCall) nativeWindow.__sabanaNativeResolve?.(pairCall.args[0], JSON.stringify({ ok: true, deviceName: 'RPP02N', transport: 'classic' }))
check('pairing native resolve ke nama printer', (await nativePair)?.deviceName === 'RPP02N')
const nativeSend = nativeBridge?.sendReceipt({ payloads: ['AA=='], copies: 1 })
const sendCall = nativeCalls.find((call) => call.method === 'sendReceipt')
let sentPayload = ''
try { sentPayload = JSON.parse(sendCall?.args[1] ?? '{}').payloads?.[0] ?? '' } catch { sentPayload = '' }
check('payload ESC/POS diteruskan ke bridge native', sentPayload === 'AA==', sentPayload)
if (sendCall) nativeWindow.__sabanaNativeResolve?.(sendCall.args[0], JSON.stringify({ ok: true }))
await nativeSend
uninstallNativePrinterShim()
nativeWindow.SabanaNative = undefined

check('tidak ada error React/konsol', errors.length === 0, errors.slice(0, 2).join(' | '))

await act(async () => { root.unmount() })

if (failures > 0) {
  console.error(`${failures} pemeriksaan runtime gagal`)
  process.exit(1)
}
console.log('Semua pemeriksaan runtime lolos')
