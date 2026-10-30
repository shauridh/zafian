import { useEffect, useMemo, useRef, useState, type ComponentType, type Dispatch, type SetStateAction } from 'react'
import { Banknote, ChefHat, ChevronRight, Cloud, CreditCard, History, MoreHorizontal, Moon, Package, Plus, Printer, Receipt, Save, ShoppingBag, Sun } from 'lucide-react'
import { cashMovementsForShift, cashSalesForShift, cashShortAgainstFloat, expectedCashForShift, handoverToOwner, type CartItem, type CashMovement, type HeldOrder, type PaymentMethod, type PosStore, type PreOrder, type Shift, type Transaction } from './domain/pos'
import { createAndStoreBackup, ensureDailyBackup } from './lib/backup'
import { createId } from './lib/id'
import { isOnlineMode } from './lib/online'
import { loadPosStore, savePosStore } from './lib/persistence'
import { describeStorageError } from './lib/storage'
import { brandingFromSettings, printOutcomeMessage, printReceiptPreferred } from './lib/receipt'
import { Dialog } from './components/Dialog'
import { MenuThumb } from './components/MenuThumb'
import type { OwnerTab } from './screens/owner/types'

// Mode pemilik tidak pernah dibuka kasir, jadi chunk-nya dipisah dari bundle awal.
// Chunk diambil di latar belakang saat kasir bekerja, lalu dipakai langsung —
// tanpa batas Suspense, sehingga mode pemilik tetap terbuka seketika.
type OwnerScreenComponent = ComponentType<{
  store: PosStore
  setStore: Dispatch<SetStateAction<PosStore>>
  onBack: () => void
  darkMode: boolean
  onToggleTheme: () => void
  initialTab?: OwnerTab
}>

type OrderType = 'Takeaway' | 'Dine in' | 'GoFood' | 'GrabFood' | 'ShopeeFood'
type Payment = 'Cash' | 'QRIS'
type MenuItem = { id: string; name: string; category: string; price: number; emoji: string; imageUrl?: string }
type CartLine = MenuItem & { qty: number }
const orderTypes: OrderType[] = ['Takeaway', 'Dine in', 'GoFood', 'GrabFood', 'ShopeeFood']
const orderIcons: Record<OrderType, string> = { Takeaway: '/icons/takeaway.svg', 'Dine in': '/icons/dine-in.svg', GoFood: '/icons/gofood.svg', GrabFood: '/icons/grabfood.svg', ShopeeFood: '/icons/shopeefood.svg' }
const money = (n: number) => `Rp${n.toLocaleString('id-ID')}`

type AppProps = { storageWarning?: string }

export function App({ storageWarning }: AppProps = {}) {
  const [screen, setScreen] = useState<'pos' | 'owner'>('pos')
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  const [category, setCategory] = useState('Semua')
  const [cart, setCart] = useState<CartLine[]>([])
  const [orderType, setOrderType] = useState<OrderType>('Takeaway')
  const [payment, setPayment] = useState<Payment>('Cash')
  const [preOrderPayment, setPreOrderPayment] = useState<Payment>('Cash')
  const [modal, setModal] = useState<'checkout' | 'more' | 'history' | 'transaction-detail' | 'preorder' | 'preorder-list' | 'held-orders' | 'cash-movement' | 'close-shift' | 'open-shift' | null>(null)
  const [message, setMessage] = useState('')
  const [cash, setCash] = useState('')
  const [cashPresetSelected, setCashPresetSelected] = useState(false)
  const [deliveryNote, setDeliveryNote] = useState('')
  const [dp, setDp] = useState('')
  const [cashMovementType, setCashMovementType] = useState<'in' | 'out'>('in')
  const [movementAmount, setMovementAmount] = useState('')
  const [movementNote, setMovementNote] = useState('')
  const [actualCash, setActualCash] = useState('')
  const [closeShiftNote, setCloseShiftNote] = useState('')
  const [openingFloat, setOpeningFloat] = useState('350000')
  const [openingNote, setOpeningNote] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [preOrderCustomer, setPreOrderCustomer] = useState('')
  const [preOrderPickup, setPreOrderPickup] = useState('')
  const [store, setStore] = useState<PosStore>(() => loadPosStore({ seed: !isOnlineMode() }))
  const [activeShiftId, setActiveShiftId] = useState(() => store.shifts.find((shift) => shift.status === 'open')?.id ?? '')
  const [ownerTab, setOwnerTab] = useState<OwnerTab>('ringkasan')
  const [storageError, setStorageError] = useState('')
  const [storageWarningDismissed, setStorageWarningDismissed] = useState(false)
  const [closingShift, setClosingShift] = useState(false)
  const [OwnerScreenView, setOwnerScreenView] = useState<OwnerScreenComponent | null>(null)
  const storeRef = useRef(store)
  const lastSavedRef = useRef<PosStore | null>(null)
  const darkMode = store.settings.theme === 'dark'
  const toggleTheme = () => setStore((current) => ({ ...current, settings: { ...current.settings, theme: current.settings.theme === 'dark' ? 'light' : 'dark' } }))
  const held = store.heldOrders
  const menu: MenuItem[] = store.menus.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, category: item.category, price: item.price, emoji: item.emoji, imageUrl: item.imageUrl }))
  const activeShift = store.shifts.find((shift) => shift.id === activeShiftId)
  const shiftCash = activeShift ? cashSalesForShift(store, activeShift.id) : 0
  const shiftQris = activeShift ? store.transactions.filter((item) => item.shiftId === activeShift.id && item.paymentMethod === 'QRIS' && item.status === 'completed').reduce((sum, item) => sum + item.subtotal, 0) : 0
  const historyPageSize = 6
  const sortedTransactions = useMemo(() => [...store.transactions].reverse(), [store.transactions])
  const historyPageCount = Math.max(1, Math.ceil(sortedTransactions.length / historyPageSize))
  const historyPageItems = sortedTransactions.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize)
  const selectedTransaction = store.transactions.find((item) => item.id === selectedTransactionId)
  const shiftCashIn = activeShift ? cashMovementsForShift(store, activeShift.id, 'in') : 0
  const shiftCashOut = activeShift ? cashMovementsForShift(store, activeShift.id, 'out') : 0
  const shiftExpectedCash = activeShift ? expectedCashForShift(store, activeShift) : 0
  // Kas fisik yang sudah dihitung kasir; null berarti hitungan belum diisi.
  const shiftCountedCash = actualCash.trim() !== '' && Number.isFinite(Number(actualCash)) ? Number(actualCash) : null
  // Setoran ke owner memakai kas fisik bila ada, selain itu perkiraan dari kas seharusnya.
  const shiftHandover = activeShift ? handoverToOwner(activeShift, shiftCountedCash ?? shiftExpectedCash) : 0
  const shiftHandoverShort = activeShift && shiftCountedCash !== null ? cashShortAgainstFloat(activeShift, shiftCountedCash) : 0
  useEffect(() => {
    let active = true
    void savePosStore(store)
      .then(() => { if (active) setStorageError('') })
      .catch((error: unknown) => { if (active) setStorageError(describeStorageError(error)) })
    return () => { active = false }
  }, [store])
  useEffect(() => {
    // Chunk mode pemilik diambil lebih awal agar terbuka tanpa jeda. Saat offline
    // chunk bisa gagal dimuat; percobaan diulang ketika mode pemilik dibuka.
    if (OwnerScreenView) return
    let active = true
    void import('./screens/OwnerScreen')
      .then((module) => { if (active) setOwnerScreenView(() => module.OwnerScreen) })
      .catch(() => { /* dicoba lagi saat mode pemilik dibuka */ })
    return () => { active = false }
  }, [OwnerScreenView, screen])
  useEffect(() => { storeRef.current = store }, [store])
  useEffect(() => {
    let active = true
    const runDailyBackup = () => {
      void ensureDailyBackup(storeRef.current).catch((error: unknown) => {
        if (active) setStorageError(`Backup harian gagal: ${describeStorageError(error)}`)
      })
    }
    runDailyBackup()
    const timer = window.setInterval(runDailyBackup, 30 * 60 * 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  useEffect(() => { const goOnline = () => setOnline(true); const goOffline = () => setOnline(false); window.addEventListener('online', goOnline); window.addEventListener('offline', goOffline); return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) } }, [])
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 3000); return () => clearTimeout(timer) }, [message])

  const categories = ['Semua', ...store.categories.map((item) => item.name)]
  const activeCategory = categories.includes(category) ? category : 'Semua'
  const shiftSales = new Map<string, number>()
  if (activeShift) {
    for (const transaction of store.transactions) {
      if (transaction.shiftId !== activeShift.id || transaction.status !== 'completed') continue
      for (const item of transaction.items) shiftSales.set(item.id, (shiftSales.get(item.id) ?? 0) + item.qty)
    }
  }
  const filtered = menu
    .filter((item) => activeCategory === 'Semua' || item.category === activeCategory)
    .sort((a, b) => (shiftSales.get(b.id) ?? 0) - (shiftSales.get(a.id) ?? 0))
  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + line.price * line.qty, 0), [cart])
  const cashValue = Number(cash)
  const canPayCash = payment !== 'Cash' || (cash.trim() !== '' && Number.isFinite(cashValue) && cashValue >= subtotal)
  const cashShortfall = payment === 'Cash' && cash.trim() !== '' && Number.isFinite(cashValue) && cashValue < subtotal ? subtotal - cashValue : 0
  const add = (item: MenuItem) => setCart((current) => current.some((line) => line.id === item.id) ? current.map((line) => line.id === item.id ? { ...line, qty: line.qty + 1 } : line) : [...current, { ...item, qty: 1 }])
  const update = (id: string, delta: number) => setCart((current) => current.flatMap((line) => line.id === id && line.qty + delta <= 0 ? [] : line.id === id ? [{ ...line, qty: line.qty + delta }] : [line]))
  const isDeliveryChannel = ['GoFood', 'GrabFood', 'ShopeeFood'].includes(orderType)
  const finish = (label = 'Transaksi tersimpan • siap dicetak') => {
    if (!activeShift || cart.length === 0) return
    const paymentMethod: PaymentMethod = isDeliveryChannel ? 'Unpaid' : payment
    // Jangan pernah mencatat penjualan tunai dengan uang diterima di bawah total.
    if (paymentMethod === 'Cash' && (!cash.trim() || !Number.isFinite(cashValue) || cashValue < subtotal)) {
      setMessage(`Uang diterima kurang ${money(Math.max(0, subtotal - (Number.isFinite(cashValue) ? cashValue : 0)))}`)
      return
    }
    const paidAmount = paymentMethod === 'Cash' ? cashValue : paymentMethod === 'QRIS' ? subtotal : 0
    const transaction: Transaction = { id: createId(), number: `POS-${store.nextTransactionNumber}`, createdAt: new Date().toISOString(), orderType, paymentMethod, items: cart as CartItem[], subtotal, paidAmount, change: paymentMethod === 'Cash' ? Math.max(0, paidAmount - subtotal) : 0, status: 'completed' as const, note: deliveryNote || undefined, shiftId: activeShift.id }
    setStore((current) => ({ ...current, transactions: [...current.transactions, transaction], nextTransactionNumber: current.nextTransactionNumber + 1, auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'sale' as const, detail: `${transaction.number} • ${orderType} • ${paymentMethod}` }] }))
    if (store.settings.printer.autoPrint && paymentMethod !== 'Unpaid') void printReceiptPreferred(transaction, brandingFromSettings(store.settings)).then((outcome) => { if (outcome.mode === 'failed') setMessage(printOutcomeMessage(outcome)) })
    setCart([])
    setModal(null)
    setCash('')
    setCashPresetSelected(false)
    setDeliveryNote('')
    setMessage(label)
  }
  const resumeHeldOrder = (order: HeldOrder) => { setCart(order.items.map((item) => ({ ...item, emoji: item.emoji ?? '🍽️' }))); setOrderType(order.orderType); setStore((current) => ({ ...current, heldOrders: current.heldOrders.filter((item) => item.id !== order.id) })); setModal(null); setMessage('Pesanan dilanjutkan ke keranjang') }
  const removeHeldOrder = (id: string) => setStore((current) => ({ ...current, heldOrders: current.heldOrders.filter((item) => item.id !== id) }))
  const startPreOrder = (order: PreOrder) => {
    if (!activeShift) { setModal('open-shift'); return }
    const transaction: Transaction = { id: createId(), number: `POS-${store.nextTransactionNumber}`, createdAt: new Date().toISOString(), orderType: order.orderType, paymentMethod: order.paymentMethod, items: order.items, subtotal: order.total, paidAmount: order.dp, change: 0, status: 'completed', note: `Pre-order ${order.customerName}`, shiftId: activeShift.id }
    setStore((current) => ({ ...current, transactions: [...current.transactions, transaction], nextTransactionNumber: current.nextTransactionNumber + 1, preOrders: current.preOrders.map((item) => item.id === order.id ? { ...item, status: 'processing' as const, transactionId: transaction.id } : item) }))
    setMessage(`Pre-order ${order.customerName} mulai diproses • penjualan diakui`)
  }
  const settlePreOrder = (order: PreOrder) => {
    const remaining = Math.max(0, order.total - order.dp)
    // QRIS tidak menambah kas fisik; hanya pelunasan tunai yang menjadi cash movement.
    const cashMovement = remaining > 0 && order.paymentMethod === 'Cash' && activeShift
      ? { id: createId(), createdAt: new Date().toISOString(), type: 'in' as const, amount: remaining, note: `Pelunasan ${order.customerName}`, shiftId: activeShift.id }
      : null
    setStore((current) => ({ ...current, preOrders: current.preOrders.map((item) => item.id === order.id ? { ...item, status: 'completed' as const } : item), cashMovements: cashMovement ? [...current.cashMovements, cashMovement] : current.cashMovements }))
    setMessage(`Pre-order ${order.customerName} selesai${remaining > 0 ? ` • pelunasan ${money(remaining)}` : ''}`)
  }
  const setCashDigit = (digit: string) => setCash((value) => { if (cashPresetSelected) { setCashPresetSelected(false); return digit === '00' ? '0' : digit } return value === '0' ? digit : `${value}${digit}` })

  // PIN pemilik dinonaktifkan: mode pemilik dan aksi sensitif langsung dijalankan.
  const requestOwnerAccess = (tab: OwnerTab) => { setOwnerTab(tab); setScreen('owner') }

  const retryStorage = () => {
    void savePosStore(store)
      .then(() => { lastSavedRef.current = store; setStorageError(''); setMessage('Data berhasil disimpan') })
      .catch((error: unknown) => { setStorageError(describeStorageError(error)) })
  }

  const voidSelectedTransaction = () => {
    if (!selectedTransaction) return
    if (!voidReason.trim()) { setMessage('Isi alasan void terlebih dahulu'); return }
    setStore((current) => ({
      ...current,
      transactions: current.transactions.map((item) => item.id === selectedTransaction.id ? { ...item, status: 'cancelled' as const, statusReason: voidReason.trim(), statusChangedAt: new Date().toISOString() } : item),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'void' as const, detail: `${selectedTransaction.number} — ${voidReason.trim()}` }],
    }))
    setVoidReason('')
    setMessage(`${selectedTransaction.number} di-void`)
  }

  const performCloseShift = async (countedCash: number) => {
    if (!activeShift || closingShift) return
    setClosingShift(true)
    try {
      // Snapshot diambil tepat sebelum shift ditutup; bila backup gagal, shift tetap terbuka.
      await createAndStoreBackup(store, 'before-shift-close')
      const closedStore: PosStore = {
        ...store,
        shifts: store.shifts.map((shift) => shift.id === activeShift.id ? { ...shift, actualCash: countedCash, closedAt: new Date().toISOString(), status: 'closed' as const } : shift),
        auditLog: [...store.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'shift_close' as const, detail: `Kas aktual ${money(countedCash)} • setor owner ${money(handoverToOwner(activeShift, countedCash))}` }],
      }
      await savePosStore(closedStore)
      lastSavedRef.current = closedStore
      setStore(closedStore)
      setActiveShiftId('')
      setActualCash('')
      setCloseShiftNote('')
      setModal(null)
      setMessage(`Shift ditutup • setor owner ${money(handoverToOwner(activeShift, countedCash))} • backup tersimpan`)
    } catch (error) {
      const detail = describeStorageError(error)
      setStorageError(`Tutup shift dibatalkan: ${detail}`)
      setMessage('Tutup shift dibatalkan karena backup atau penyimpanan gagal')
    } finally {
      setClosingShift(false)
    }
  }

  const requestCloseShift = () => {
    const countedCash = Number(actualCash)
    if (!activeShift) { setMessage('Tidak ada shift aktif'); return }
    if (actualCash.trim() === '' || !Number.isFinite(countedCash) || countedCash < 0) { setMessage('Isi uang fisik aktual terlebih dahulu'); return }
    void performCloseShift(countedCash)
  }

  const openShift = () => {
    const parsed = Number(openingFloat)
    const opening = Number.isFinite(parsed) && parsed >= 0 ? parsed : 350000
    const shift: Shift = { id: createId(), openedAt: new Date().toISOString(), openingFloat: opening, status: 'open' }
    const note = openingNote.trim()
    setStore((current) => ({
      ...current,
      shifts: [...current.shifts, shift],
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'shift_open' as const, detail: `Float ${money(opening)}${note ? ` • ${note}` : ''}` }],
    }))
    setActiveShiftId(shift.id)
    setOpeningNote('')
    setModal(null)
    setMessage(`Shift dibuka • float ${money(opening)}`)
  }

  const storageAlerts = <>
    {storageError && <div className="storage-alert danger" role="alert"><strong>Data gagal disimpan</strong><span>{storageError}</span><div><button onClick={retryStorage}>Coba lagi</button><button onClick={() => setStorageError('')}>Tutup</button></div></div>}
    {storageWarning && !storageWarningDismissed && <div className="storage-alert warning" role="status"><strong>Perhatian penyimpanan</strong><span>{storageWarning}</span><div><button onClick={() => setStorageWarningDismissed(true)}>Mengerti</button></div></div>}
  </>

  if (screen === 'owner') return <>
    {OwnerScreenView
      ? <OwnerScreenView store={store} setStore={setStore} onBack={() => setScreen('pos')} darkMode={darkMode} onToggleTheme={toggleTheme} initialTab={ownerTab} />
      : <div className="boot-screen">Memuat mode pemilik…</div>}
    {storageAlerts}
  </>

  return <div className={darkMode ? 'pos-shell pos-screen dark-theme' : 'pos-shell pos-screen'}>
    <header className="pos-topbar">
      <div className="brand"><div className="brand-mark"><ChefHat size={20} /></div><div><strong>Sabana POS</strong><span>{store.settings.outletName}</span>{store.settings.outletPhone && <span className="brand-phone">{store.settings.outletPhone}</span>}</div></div>
      <div className="top-actions"><button className="top-status printer-status" onClick={() => requestOwnerAccess('pengaturan')} aria-label="Pengaturan printer" title="Pengaturan printer"><Printer size={17} /></button><button className={`top-status save-status${online ? '' : ' offline'}`} onClick={() => { void savePosStore(store).then(() => { lastSavedRef.current = store; setMessage(online ? 'Tersimpan aman di perangkat' : 'Offline • data tersimpan di perangkat') }).catch((error: unknown) => setStorageError(describeStorageError(error))) }} aria-label={online ? 'Online, klik untuk simpan ulang data ke perangkat' : 'Offline, data tersimpan lokal'} title={online ? 'Online — simpan ke perangkat' : 'Offline — tersimpan lokal'}><Save size={17} /></button><button className="top-status history-status" onClick={() => setModal('history')} aria-label="Riwayat transaksi" title="Riwayat transaksi"><History size={17} /></button><button className="top-status theme-status" onClick={toggleTheme} aria-label={darkMode ? 'Gunakan tema terang' : 'Gunakan tema gelap'} title={darkMode ? 'Tema terang' : 'Tema gelap'}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-btn" onClick={() => setModal('more')} aria-label="Menu"><MoreHorizontal /></button><button className="avatar" onClick={() => requestOwnerAccess('ringkasan')} aria-label="Buka mode pemilik" title="Mode pemilik">P</button></div>
    </header>
    <main className="pos-main">
      <section className="catalog">
        <div className="category-row" role="group" aria-label="Kategori menu">{categories.map((item) => <button key={item} className={activeCategory === item ? 'category active' : 'category'} aria-pressed={activeCategory === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="menu-grid">{filtered.map((item) => <button className="menu-card" key={item.id} onClick={() => add(item)} aria-label={`Tambah ${item.name} ${money(item.price)}`}><div className="menu-art"><MenuThumb name={item.name} emoji={item.emoji} imageUrl={item.imageUrl} /></div><div className="menu-info"><strong>{item.name}</strong><span>{item.category}</span><b>{money(item.price)}</b></div><span className="add-btn" aria-hidden="true"><Plus size={17} /></span></button>)}{filtered.length === 0 && <div className="catalog-empty">Belum ada menu aktif di kategori ini.</div>}</div>
      </section>
      <aside className="order-panel" aria-label="Keranjang pesanan">
        <div className="order-head"><div><span className="eyebrow">TRANSAKSI #{store.nextTransactionNumber}</span><h2>Keranjang</h2></div><div className="order-head-actions"><button className="held-btn icon-only" onClick={() => setModal('preorder-list')} aria-label="Daftar pre-order" title="Daftar pre-order"><Package size={17} />{store.preOrders.filter((item) => item.status !== 'completed' && item.status !== 'cancelled').length > 0 && <span className="held-count">{store.preOrders.filter((item) => item.status !== 'completed' && item.status !== 'cancelled').length}</span>}</button><button className="held-btn icon-only" onClick={() => setModal('held-orders')} aria-label="Pesanan ditahan" title="Pesanan ditahan"><img src="/icons/held.svg" alt="" />{held.length > 0 && <span className="held-count">{held.length}</span>}</button></div></div>
        {!activeShift ? <div className="empty-cart"><div className="empty-icon"><Banknote /></div><strong>Shift belum dibuka</strong><span>Buka shift terlebih dahulu untuk mulai menerima transaksi</span><button className="checkout-btn open-shift-inline" onClick={() => setModal('open-shift')}>Buka shift</button></div> : cart.length === 0 ? <div className="empty-cart"><div className="empty-icon"><ShoppingBag /></div><strong>Keranjang masih kosong</strong><span>Pilih menu untuk mulai membuat pesanan</span></div> : <div className="cart-list">{cart.map((line) => <div className="cart-line" key={line.id}><div className="cart-thumb"><MenuThumb name={line.name} emoji={line.emoji} imageUrl={line.imageUrl} /></div><div className="cart-detail"><strong>{line.name}</strong><span>{money(line.price)}</span></div><div className="qty"><button onClick={() => update(line.id, -1)} aria-label={`Kurangi ${line.name}`}><span aria-hidden="true">−</span></button><b aria-label={`Jumlah ${line.name}`}>{line.qty}</b><button onClick={() => update(line.id, 1)} aria-label={`Tambah ${line.name}`}><span aria-hidden="true">+</span></button></div><b className="line-total">{money(line.price * line.qty)}</b></div>)}</div>}
        <div className="order-footer"><div className="order-type-label"><span>Tipe pesanan</span><b>Takeaway default</b></div><div className="type-grid" role="group" aria-label="Tipe pesanan">{orderTypes.map((type) => <button key={type} className={orderType === type ? 'type-btn active' : 'type-btn'} onClick={() => setOrderType(type)} aria-label={type} aria-pressed={orderType === type} title={type}><img src={orderIcons[type]} alt="" /></button>)}</div><div className="totals"><span>Subtotal <b>{money(subtotal)}</b></span><span>Diskon <b>—</b></span><div><strong>Total</strong><strong className="total-price">{money(subtotal)}</strong></div></div><button className="checkout-btn" disabled={!cart.length || !activeShift} onClick={() => { setCash(''); setCashPresetSelected(false); setModal('checkout') }}>Proses pesanan <ChevronRight size={18} /></button><div className="quick-actions"><button onClick={() => { if (!activeShift) { setModal('open-shift'); return } if (cart.length) { const heldOrder: HeldOrder = { id: createId(), createdAt: new Date().toISOString(), items: cart as CartItem[], orderType }; setStore((current) => ({ ...current, heldOrders: [...current.heldOrders, heldOrder] })); setCart([]); setMessage('Pesanan ditahan') } }}><Receipt size={16} /> Tahan pesanan</button><button onClick={() => { if (!activeShift) { setModal('open-shift'); return } setModal('preorder') }}><Package size={16} /> Pre-order + DP</button></div></div>
      </aside>
    </main>
    {message && <div className="toast" role="status" aria-live="polite"><span className="live-dot" aria-hidden="true" />{message}</div>}
    {modal === 'checkout' && <Dialog eyebrow={`CHECKOUT • ${orderType.toUpperCase()}`} heading="Pilih pembayaran" onClose={() => setModal(null)}><p className="modal-muted">Total yang harus dibayar</p><div className="modal-total">{money(subtotal)}</div>{isDeliveryChannel ? <><p className="modal-muted">{orderType} dicatat sebagai kanal pesanan. Tidak ada pembayaran di aplikasi.</p><textarea className="cash-input note-input" placeholder="Catatan pesanan (opsional)" aria-label="Catatan pesanan" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} /><button className="checkout-btn" onClick={() => finish(`${orderType} tersimpan • tanpa pembayaran`)}>Simpan pesanan <ChevronRight size={18} /></button></> : <><div className="payment-grid" role="group" aria-label="Metode pembayaran"><button className={payment === 'Cash' ? 'payment active' : 'payment'} onClick={() => setPayment('Cash')} aria-pressed={payment === 'Cash'}><Banknote /><span>Cash</span></button><button className={payment === 'QRIS' ? 'payment active' : 'payment'} onClick={() => setPayment('QRIS')} aria-pressed={payment === 'QRIS'}><CreditCard /><span>QRIS</span></button></div>{payment === 'Cash' && <><label className="cash-field"><span>Uang diterima</span><input className="cash-input" type="number" inputMode="numeric" min={0} placeholder="Uang diterima" aria-label="Uang diterima" value={cash} onChange={(e) => { setCash(e.target.value); setCashPresetSelected(false) }} /></label><div className="cash-presets">{[subtotal, 10000, 20000, 50000, 100000].map((value, index) => { const disabled = value < subtotal; return <button key={`${value}-${index}`} className={index === 0 ? 'exact-cash' : undefined} disabled={disabled} onClick={() => { setCash(String(value)); setCashPresetSelected(true) }}>{index === 0 ? <><span>Uang pas</span><small>{money(value)}</small></> : money(value)}</button> })}</div></>}{payment === 'Cash' && cashShortfall > 0 && <p className="cash-short" role="alert">Uang diterima kurang {money(cashShortfall)}.</p>}{payment === 'Cash' && cash && !cashShortfall && <div className="change">Kembalian <b>{money(Math.max(0, cashValue - subtotal))}</b></div>}{payment === 'Cash' && <div className="numpad">{['1','2','3','4','5','6','7','8','9','00','0','⌫'].map((key) => <button key={key} onClick={() => key === '⌫' ? (setCash((value) => value.slice(0, -1)), setCashPresetSelected(false)) : setCashDigit(key)} aria-label={key === '⌫' ? 'Hapus digit terakhir' : `Digit ${key}`}>{key}</button>)}</div>}<button className="checkout-btn" onClick={() => finish()} disabled={!canPayCash}><Printer size={18} /> Bayar & cetak struk</button></>}</Dialog>}
    {modal === 'history' && <Dialog eyebrow="DATA TRANSAKSI" heading="Riwayat transaksi" variant="history" onClose={() => setModal(null)}><p className="modal-muted">{store.transactions.length} transaksi tersimpan • ketuk untuk detail</p><div className="history-list">{historyPageItems.length === 0 ? <div className="history-empty">Belum ada transaksi tersimpan.</div> : historyPageItems.map((transaction) => <button className="history-row" key={transaction.id} onClick={() => { setSelectedTransactionId(transaction.id); setVoidReason(''); setModal('transaction-detail') }}><div><strong>{transaction.number}</strong><span>{new Date(transaction.createdAt).toLocaleString('id-ID')} • {transaction.orderType}</span></div><div><b>{money(transaction.subtotal)}</b><span>{transaction.status === 'completed' ? transaction.paymentMethod : transaction.status === 'refunded' ? 'Refund' : 'Void'}</span></div></button>)}</div>{historyPageCount > 1 && <div className="history-pagination"><button disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>‹ Sebelumnya</button><span>Halaman {historyPage} / {historyPageCount}</span><button disabled={historyPage >= historyPageCount} onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))}>Berikutnya ›</button></div>}<button className="checkout-btn" onClick={() => setModal(null)}>Tutup</button></Dialog>}
    {modal === 'transaction-detail' && selectedTransaction && <Dialog eyebrow="STRUK TRANSAKSI" label={`Detail transaksi ${selectedTransaction.number}`} variant="history" onClose={() => setModal(null)}><div className="receipt"><div className="receipt-head"><strong>{store.settings.businessName.toUpperCase()}</strong><span>{store.settings.outletName}</span>{store.settings.outletPhone && <span>{store.settings.outletPhone}</span>}</div><div className="receipt-meta"><span>{selectedTransaction.number}</span><span>{new Date(selectedTransaction.createdAt).toLocaleString('id-ID')}</span><span>{selectedTransaction.orderType}</span></div><div className="receipt-rule" /><div className="detail-items">{selectedTransaction.items.map((item) => <div className="detail-item" key={item.id}><span>{item.qty}× {item.name}</span><b>{money(item.price * item.qty)}</b></div>)}</div><div className="receipt-rule" /><div className="receipt-total"><span>TOTAL</span><b>{money(selectedTransaction.subtotal)}</b></div><div className="receipt-meta"><span>{selectedTransaction.paymentMethod}</span><span>Bayar {money(selectedTransaction.paidAmount)}</span><span>Kembali {money(selectedTransaction.change)}</span></div>{selectedTransaction.status !== 'completed' && <div className="receipt-status">VOID{selectedTransaction.statusReason ? ` — ${selectedTransaction.statusReason}` : ''}</div>}<div className="receipt-foot">{store.settings.receiptFooter}</div>{store.settings.receiptPromo.trim() && <div className="receipt-promo">{store.settings.receiptPromo}</div>}</div>{selectedTransaction.status === 'completed' && <label className="cash-field"><span>Alasan void (wajib)</span><input className="cash-input void-reason" placeholder="Alasan void (wajib)" aria-label="Alasan void" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} /></label>}<div className="detail-actions"><button className="detail-action danger" onClick={() => { if (!voidReason.trim()) { setMessage('Isi alasan void terlebih dahulu'); return } voidSelectedTransaction() }}>Void</button><button className="detail-action primary" onClick={() => { void printReceiptPreferred(selectedTransaction, brandingFromSettings(store.settings)).then((outcome) => setMessage(printOutcomeMessage(outcome))) }}><Printer size={16} /> Cetak</button></div></Dialog>}
    {modal === 'preorder' && <Dialog eyebrow="PRE-ORDER" heading="Buat pesanan dengan DP" onClose={() => setModal(null)}><p className="modal-muted">Pesanan dicatat dan stok berkurang saat mulai diproses.</p><input className="cash-input" placeholder="Nama pelanggan" aria-label="Nama pelanggan" value={preOrderCustomer} onChange={(e) => setPreOrderCustomer(e.target.value)} /><input className="cash-input" placeholder="Jam pengambilan" aria-label="Jam pengambilan" type="datetime-local" value={preOrderPickup} onChange={(e) => setPreOrderPickup(e.target.value)} /><div className="payment-grid" role="group" aria-label="Metode pembayaran DP"><button className={preOrderPayment === 'Cash' ? 'payment active' : 'payment'} onClick={() => setPreOrderPayment('Cash')} aria-pressed={preOrderPayment === 'Cash'}><Banknote /><span>Cash</span></button><button className={preOrderPayment === 'QRIS' ? 'payment active' : 'payment'} onClick={() => setPreOrderPayment('QRIS')} aria-pressed={preOrderPayment === 'QRIS'}><CreditCard /><span>QRIS</span></button></div><div className="dp-presets">{[25, 50, 75, 100].map((percent) => <button key={percent} onClick={() => setDp(String(Math.round(subtotal * percent / 100)))} aria-label={`DP ${percent} persen`}>{percent}%<small>{money(Math.round(subtotal * percent / 100))}</small></button>)}</div><label className="cash-field"><span>Nominal DP</span><input className="cash-input" placeholder="Nominal DP manual" aria-label="Nominal DP manual" type="number" inputMode="numeric" value={dp} onChange={(e) => setDp(e.target.value)} /></label><button className="checkout-btn" onClick={() => { const total = subtotal; const dpAmount = Number(dp) || 0; const preOrder: PreOrder = { id: createId(), createdAt: new Date().toISOString(), customerName: preOrderCustomer.trim() || 'Pelanggan', pickupAt: preOrderPickup || new Date().toISOString(), items: cart as CartItem[], orderType, total, dp: dpAmount, paymentMethod: preOrderPayment, status: dpAmount > 0 ? 'dp_received' : 'draft' }; setStore((current) => ({ ...current, preOrders: [...current.preOrders, preOrder], auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'preorder' as const, detail: `${preOrder.customerName} • DP ${money(dpAmount)}` }] })); setCart([]); setModal(null); setDp(''); setPreOrderCustomer(''); setPreOrderPickup(''); setPreOrderPayment('Cash'); setMessage(`Pre-order tersimpan • DP ${money(dpAmount)}`) }}>Simpan pre-order</button></Dialog>}
    {modal === 'open-shift' && <Dialog eyebrow="MULAI OPERASIONAL" heading="Buka shift kasir" variant="small" onClose={() => setModal(null)}><p className="modal-muted">Masukkan float awal. Nilai default Rp350.000 dan dapat ditambah jika diperlukan.</p><label className="cash-field"><span>Float awal</span><input id="opening-float" className="cash-input" type="number" inputMode="numeric" min={0} value={openingFloat} placeholder="Float awal" aria-label="Float awal" onChange={(e) => setOpeningFloat(e.target.value)} /></label><textarea className="cash-input note-input" placeholder="Catatan pembukaan (opsional)" aria-label="Catatan pembukaan" value={openingNote} onChange={(e) => setOpeningNote(e.target.value)} /><button className="checkout-btn" onClick={openShift}>Buka shift</button></Dialog>}
    {modal === 'more' && <Dialog eyebrow="SHIFT AKTIF" heading="Ringkasan kasir" variant="small" onClose={() => setModal(null)}><div className="summary-row"><span>Float awal</span><b>{activeShift ? money(activeShift.openingFloat) : money(0)}</b></div><div className="summary-row"><span>Penjualan cash</span><b>{money(shiftCash)}</b></div><div className="summary-row"><span>Total QRIS</span><b>{money(shiftQris)}</b></div><div className="summary-row"><span>Cash in</span><b>{money(shiftCashIn)}</b></div><div className="summary-row"><span>Cash out</span><b>{money(shiftCashOut)}</b></div><div className="summary-row"><span>Kas seharusnya</span><b>{activeShift ? money(expectedCashForShift(store, activeShift)) : money(0)}</b></div><div className="more-actions"><button disabled={!activeShift} onClick={() => { setMovementAmount(''); setMovementNote(''); setModal('cash-movement') }}><Banknote size={16} /> Cash in/out</button><button disabled={!activeShift} onClick={() => { setActualCash(''); setCloseShiftNote(''); setModal('close-shift') }}><Cloud size={16} /> Tutup shift</button></div><button className="checkout-btn" onClick={() => setModal(null)}>Tutup</button></Dialog>}
    {modal === 'held-orders' && <Dialog eyebrow="PESANAN DITAHAN" heading="Lanjutkan pesanan" variant="history" onClose={() => setModal(null)}><p className="modal-muted">{held.length} pesanan tersimpan di perangkat ini</p><div className="history-list">{held.length === 0 ? <div className="history-empty">Belum ada pesanan ditahan.</div> : held.map((order) => <div className="held-row" key={order.id}><div className="held-copy"><strong>{order.items.reduce((sum, item) => sum + item.qty, 0)} item • {order.orderType}</strong><span>{order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}</span><span>{new Date(order.createdAt).toLocaleString('id-ID')}</span></div><div className="held-side"><b>{money(order.items.reduce((sum, item) => sum + item.price * item.qty, 0))}</b><div className="held-actions"><button onClick={() => resumeHeldOrder(order)}>Lanjutkan</button><button className="danger" onClick={() => removeHeldOrder(order.id)}>Hapus</button></div></div></div>)}</div><button className="checkout-btn" onClick={() => setModal(null)}>Tutup</button></Dialog>}
    {modal === 'preorder-list' && <Dialog eyebrow="PRE-ORDER" heading="Daftar pre-order" variant="history" onClose={() => setModal(null)}><p className="modal-muted">Penjualan diakui saat pesanan mulai diproses.</p><div className="history-list">{store.preOrders.length === 0 ? <div className="history-empty">Belum ada pre-order.</div> : [...store.preOrders].reverse().map((order) => { const remaining = Math.max(0, order.total - order.dp); return <div className="held-row" key={order.id}><div className="held-copy"><strong>{order.customerName} • {order.orderType}</strong><span>{order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}</span><span>{order.status === 'dp_received' ? 'DP diterima' : order.status === 'processing' ? 'Diproses' : order.status === 'completed' ? 'Selesai' : order.status}</span><span>Total {money(order.total)} • DP {money(order.dp)} • Sisa {money(remaining)}</span></div><div className="held-side">{(order.status === 'draft' || order.status === 'dp_received') && <div className="held-actions"><button onClick={() => startPreOrder(order)}>Mulai proses</button></div>}{order.status === 'processing' && <div className="held-actions"><button onClick={() => settlePreOrder(order)}>Pelunasan</button></div>}</div></div> })}</div><button className="checkout-btn" onClick={() => setModal(null)}>Tutup</button></Dialog>}
    {modal === 'cash-movement' && <Dialog eyebrow="SHIFT AKTIF" heading="Cash in / out" variant="small" onClose={() => setModal(null)}><div className="movement-tabs" role="group" aria-label="Jenis pergerakan kas"><button className={cashMovementType === 'in' ? 'movement-tab active' : 'movement-tab'} onClick={() => setCashMovementType('in')} aria-pressed={cashMovementType === 'in'}>Cash in</button><button className={cashMovementType === 'out' ? 'movement-tab active' : 'movement-tab'} onClick={() => setCashMovementType('out')} aria-pressed={cashMovementType === 'out'}>Cash out</button></div><label className="cash-field"><span>Nominal</span><input className="cash-input" type="number" inputMode="numeric" min={0} placeholder="Nominal" aria-label="Nominal cash movement" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} /></label><textarea className="cash-input note-input" placeholder="Catatan wajib, misalnya: beli es batu" aria-label="Catatan cash movement" value={movementNote} onChange={(e) => setMovementNote(e.target.value)} /><button className="checkout-btn" onClick={() => { const amount = Number(movementAmount); const note = movementNote.trim(); if (!activeShift) { setModal(null); setMessage('Buka shift terlebih dahulu'); return } if (!Number.isFinite(amount) || amount <= 0 || !note) { setMessage('Isi nominal dan catatan terlebih dahulu'); return } const movement: CashMovement = { id: createId(), createdAt: new Date().toISOString(), type: cashMovementType, amount, note, shiftId: activeShift.id }; setStore((current) => ({ ...current, cashMovements: [...current.cashMovements, movement], auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: cashMovementType === 'in' ? 'cash_in' as const : 'cash_out' as const, detail: `${money(amount)} — ${note}` }] })); setMovementAmount(''); setMovementNote(''); setModal(null); setMessage(`${cashMovementType === 'in' ? 'Cash in' : 'Cash out'} tersimpan`) }}>Simpan cash movement</button></Dialog>}
    {modal === 'close-shift' && <Dialog eyebrow="KONSOLIDASI SHIFT" heading="Tutup shift" variant="small" onClose={() => setModal(null)}><p className="modal-muted">Backup otomatis dibuat sebelum shift ditutup; setoran ke owner dihitung dari kas fisik yang dihitung.</p><div className="summary-row"><span>Float awal</span><b>{activeShift ? money(activeShift.openingFloat) : money(0)}</b></div><div className="summary-row"><span>Penjualan cash</span><b>{money(shiftCash)}</b></div><div className="summary-row"><span>Total QRIS</span><b>{money(shiftQris)}</b></div><div className="summary-row"><span>Cash in</span><b>{money(shiftCashIn)}</b></div><div className="summary-row"><span>Cash out</span><b>{money(shiftCashOut)}</b></div><div className="summary-row"><span>Kas seharusnya</span><b>{money(shiftExpectedCash)}</b></div><div className="summary-row handover-row"><span>Setor ke owner</span><b>{money(shiftHandover)}</b></div><p className="handover-note">{shiftCountedCash === null ? `Perkiraan dari kas seharusnya ${money(shiftExpectedCash)}; isi uang fisik aktual untuk angka final. Float awal ${money(activeShift?.openingFloat ?? 0)} tetap di kasir.` : shiftHandoverShort > 0 ? `Kas fisik kurang ${money(shiftHandoverShort)} dari float awal ${money(activeShift?.openingFloat ?? 0)} — tidak ada setoran ke owner.` : `Uang fisik ${money(shiftCountedCash)} dikurangi float awal ${money(activeShift?.openingFloat ?? 0)}; float tetap di kasir.`}</p>{actualCash !== '' && activeShift && <div className="summary-row shift-difference"><span>Selisih</span><b>{money(Number(actualCash) - expectedCashForShift(store, activeShift))}</b></div>}<label className="cash-field"><span>Uang fisik aktual</span><input className="cash-input" type="number" inputMode="numeric" min={0} placeholder="Uang fisik aktual" aria-label="Uang fisik aktual" value={actualCash} onChange={(e) => setActualCash(e.target.value)} /></label><textarea className="cash-input note-input" placeholder="Catatan serah-terima (opsional)" aria-label="Catatan serah-terima" value={closeShiftNote} onChange={(e) => setCloseShiftNote(e.target.value)} /><button className="checkout-btn" onClick={requestCloseShift} disabled={closingShift}>{closingShift ? 'Menyiapkan backup…' : 'Konfirmasi tutup shift'}</button></Dialog>}
    {storageAlerts}
  </div>
}
