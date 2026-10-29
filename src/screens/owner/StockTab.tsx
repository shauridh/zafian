import { useMemo, useState } from 'react'
import { Boxes, ClipboardCheck, PackagePlus, Pencil, Plus, Ruler, Search, SlidersHorizontal, Trash2 } from 'lucide-react'

import type { Ingredient } from '../../domain/catalog'
import { inventoryRows, type StockMovement } from '../../domain/inventory'
import { applyIngredientUsageBulk, removeIngredient } from '../../lib/catalog-ops'
import { createId } from '../../lib/id'
import type { OwnerTabProps } from './types'
import { ConfirmDialog, EmptyState, Field, Modal, money } from './ui'
import { IngredientEditor } from './IngredientEditor'
import { OpnameEditor } from './OpnameEditor'

type PurchaseLine = {
  id: string
  ingredientId: string
  /** Jumlah dalam satuan pakai yang disimpan ke stok. */
  qty: number
  totalCost: number
  note: string
  mode: 'unit' | 'pack'
  /** Jumlah seperti yang diketik kasir (pack atau satuan). */
  enteredQty: number
}

export function StockTab({ store, setStore, notify }: OwnerTabProps) {
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('Semua')
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null)
  const [opnameEditing, setOpnameEditing] = useState<StockMovement | 'new' | null>(null)
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [draft, setDraft] = useState<PurchaseLine[]>([])
  const [pendingDelete, setPendingDelete] = useState<{ ingredient: Ingredient; usedBy: string[] } | null>(null)
  const [pendingOpnameDelete, setPendingOpnameDelete] = useState<StockMovement | null>(null)
  const [lineIngredient, setLineIngredient] = useState(store.ingredients[0]?.id ?? '')
  const [lineQty, setLineQty] = useState('')
  const [lineCost, setLineCost] = useState('')
  const [lineNote, setLineNote] = useState('')
  const [purchaseMode, setPurchaseMode] = useState<'unit' | 'pack'>('unit')
  const [standardOpen, setStandardOpen] = useState(false)
  const [standardQuery, setStandardQuery] = useState('')
  const [standardDraft, setStandardDraft] = useState<Record<string, string>>({})

  const rows = useMemo(() => inventoryRows(store.ingredients, store.menus, store.transactions, store.stockMovements), [store])
  const categoryOptions = useMemo(() => {
    const names = new Set<string>((store.ingredientCategories ?? []).map((item) => item.name))
    for (const ingredient of store.ingredients) names.add(ingredient.category || 'Lainnya')
    return [...names]
  }, [store.ingredientCategories, store.ingredients])
  const activeCategory = categoryFilter === 'Semua' || categoryOptions.includes(categoryFilter) ? categoryFilter : 'Semua'
  const filteredRows = rows.filter((row) => {
    if (activeCategory !== 'Semua') {
      const ingredient = store.ingredients.find((item) => item.id === row.ingredientId)
      if ((ingredient?.category || 'Lainnya') !== activeCategory) return false
    }
    return !query.trim() || row.name.toLowerCase().includes(query.trim().toLowerCase())
  })
  const selectedId = store.ingredients.some((item) => item.id === lineIngredient) ? lineIngredient : store.ingredients[0]?.id ?? ''
  const selected = store.ingredients.find((item) => item.id === selectedId)
  const enteredQty = Number(lineQty) || 0
  const estimated = enteredQty * (selected?.costPerUnit ?? 0)
  const packCost = enteredQty * (selected?.purchasePrice ?? 0)
  const packUsage = enteredQty * (selected?.usagePerPurchaseUnit ?? 0)
  const draftTotal = draft.reduce((sum, line) => sum + line.totalCost, 0)
  const opnames = useMemo(() => store.stockMovements.filter((movement) => movement.type === 'opname').slice().reverse(), [store.stockMovements])
  const standards = store.settings.ingredientUsage ?? {}
  const standardRows = store.ingredients.filter((ingredient) => !standardQuery.trim() || ingredient.name.toLowerCase().includes(standardQuery.trim().toLowerCase()))
  const standardFilled = Object.values(standardDraft).filter((value) => Number(value) > 0).length

  const switchMode = (mode: 'unit' | 'pack') => {
    setPurchaseMode(mode)
    setLineQty('')
    setLineCost('')
  }

  const addLine = () => {
    if (!selected) { notify('Tambahkan bahan baku terlebih dahulu'); return }
    if (!Number.isFinite(enteredQty) || enteredQty <= 0) { notify('Jumlah pembelian harus lebih dari 0'); return }
    const isPack = purchaseMode === 'pack'
    // Mode pack: qty dikonversi ke satuan pakai, biaya memakai harga beli per kemasan.
    const qty = isPack ? enteredQty * selected.usagePerPurchaseUnit : enteredQty
    const cost = isPack ? enteredQty * selected.purchasePrice : lineCost.trim() ? Number(lineCost) : enteredQty * selected.costPerUnit
    if (!Number.isFinite(cost) || cost < 0) { notify('Biaya pembelian tidak valid'); return }
    const defaultNote = isPack ? `${enteredQty} ${selected.purchaseUnit} ${selected.name}` : `Pembelian ${selected.name}`
    setDraft((current) => [...current, { id: createId(), ingredientId: selected.id, qty, totalCost: cost, note: lineNote.trim() || defaultNote, mode: purchaseMode, enteredQty }])
    setLineQty('')
    setLineCost('')
    setLineNote('')
    notify(`${selected.name} masuk daftar pembelian`)
  }

  const saveDraft = () => {
    if (draft.length === 0) { notify('Belum ada baris pembelian'); return }
    const createdAt = new Date().toISOString()
    setStore((current) => ({
      ...current,          stockMovements: [
        ...current.stockMovements,
        ...draft.map((line) => ({ id: line.id, createdAt, ingredientId: line.ingredientId, type: 'purchase' as const, qty: line.qty, totalCost: line.totalCost, note: line.note })),
      ],
      auditLog: [
        ...current.auditLog,
        ...draft.map((line) => {
          const ingredient = current.ingredients.find((item) => item.id === line.ingredientId)
          const qtyLabel = line.mode === 'pack' ? `${line.enteredQty} ${ingredient?.purchaseUnit ?? 'pack'} (${line.qty} ${ingredient?.unit ?? 'unit'})` : `${line.qty} ${ingredient?.unit ?? 'unit'}`
          return { id: createId(), createdAt, action: 'purchase' as const, detail: `${qtyLabel} ${ingredient?.name ?? 'bahan'} • ${money(line.totalCost)}` }
        }),
      ],
    }))
    notify(`${draft.length} pembelian tersimpan • ${money(draftTotal)}`)
    setDraft([])
  }

  const openAdjust = (ingredient: Ingredient) => {
    setAdjusting(ingredient)
    setAdjustQty('')
    setAdjustNote('')
  }

  const requestDelete = (ingredient: Ingredient) => {
    setPendingDelete({
      ingredient,
      usedBy: store.menus.filter((menu) => menu.recipe.some((line) => line.ingredientId === ingredient.id)).map((menu) => menu.name),
    })
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const { ingredient, usedBy } = pendingDelete
    setStore((current) => removeIngredient(current, ingredient).store)
    setPendingDelete(null)
    notify(usedBy.length > 0 ? `${ingredient.name} dihapus • dilepas dari ${usedBy.length} resep` : `${ingredient.name} dihapus`)
  }

  const openStandards = () => {
    const draft: Record<string, string> = {}
    for (const ingredient of store.ingredients) {
      const qty = standards[ingredient.id]
      if (typeof qty === 'number' && qty > 0) draft[ingredient.id] = String(qty)
    }
    setStandardDraft(draft)
    setStandardQuery('')
    setStandardOpen(true)
  }

  const saveStandards = () => {
    const { store: next, set, cleared } = applyIngredientUsageBulk(store, standardDraft)
    setStore(next)
    setStandardOpen(false)
    notify(set > 0
      ? `Pemakaian standar ${set} bahan disimpan${cleared > 0 ? ` • ${cleared} dikosongkan` : ''}`
      : cleared > 0 ? `${cleared} pemakaian standar dikosongkan` : 'Belum ada pemakaian standar yang diisi')
  }

  const deleteOpname = () => {
    if (!pendingOpnameDelete) return
    const movement = pendingOpnameDelete
    const ingredient = store.ingredients.find((item) => item.id === movement.ingredientId)
    setPendingOpnameDelete(null)
    setStore((current) => ({
      ...current,
      stockMovements: current.stockMovements.filter((item) => item.id !== movement.id),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'opname' as const, detail: `Hapus opname ${ingredient?.name ?? movement.ingredientId}` }],
    }))
    notify(`Opname ${ingredient?.name ?? 'bahan'} dihapus`)
  }

  const saveAdjust = () => {
    if (!adjusting) return
    const qty = Number(adjustQty)
    if (!Number.isFinite(qty) || qty === 0) { notify('Isi jumlah penyesuaian (+/-)'); return }
    setStore((current) => ({
      ...current,
      stockMovements: [...current.stockMovements, { id: createId(), createdAt: new Date().toISOString(), ingredientId: adjusting.id, type: 'adjustment' as const, qty, totalCost: 0, note: adjustNote.trim() || 'Penyesuaian manual' }],
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'adjustment' as const, detail: `${adjusting.name} ${qty > 0 ? '+' : ''}${qty} ${adjusting.unit}` }],
    }))
    notify(`${adjusting.name} disesuaikan ${qty > 0 ? '+' : ''}${qty} ${adjusting.unit}`)
    setAdjusting(null)
  }

  return (
    <>
      <section className="owner-panel">
        <div className="owner-panel-head">
          <div><h2>Pembelian massal</h2><p className="owner-muted">Kumpulkan beberapa bahan dulu, lalu simpan sekaligus. Pembelian otomatis masuk ke jurnal.</p></div>
          <span className="owner-count">{draft.length} baris</span>
        </div>
        <div className="purchase-mode">
          <div className="owner-segment">
            <button type="button" className={purchaseMode === 'unit' ? 'active' : ''} onClick={() => switchMode('unit')}>Per satuan</button>
            <button type="button" className={purchaseMode === 'pack' ? 'active' : ''} onClick={() => switchMode('pack')}>Per pack</button>
          </div>
          <span>{purchaseMode === 'pack' && selected ? `Jumlah pack dikonversi otomatis: 1 ${selected.purchaseUnit} = ${selected.usagePerPurchaseUnit} ${selected.unit}.` : 'Masukkan jumlah dalam satuan pakai bahan, mis. gram, potong, atau pcs.'}</span>
        </div>
        <div className="purchase-form">
          <select value={selectedId} onChange={(event) => setLineIngredient(event.target.value)} aria-label="Bahan yang dibeli">
            {store.ingredients.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
          </select>
          <input type="number" min="0" step="0.01" placeholder={selected ? `Jumlah (${purchaseMode === 'pack' ? selected.purchaseUnit : selected.unit})` : 'Jumlah'} value={lineQty} onChange={(event) => setLineQty(event.target.value)} aria-label="Jumlah pembelian" />
          <input
            type="number"
            min="0"
            readOnly={purchaseMode === 'pack'}
            placeholder={purchaseMode === 'pack' ? `Biaya otomatis ${money(packCost)}` : `Biaya (estimasi ${money(estimated)})`}
            value={purchaseMode === 'pack' ? (enteredQty > 0 ? String(packCost) : '') : lineCost}
            onChange={purchaseMode === 'pack' ? undefined : (event) => setLineCost(event.target.value)}
            aria-label="Total biaya pembelian"
          />
          <input placeholder="Catatan / supplier (opsional)" value={lineNote} onChange={(event) => setLineNote(event.target.value)} aria-label="Catatan pembelian" />
          <button className="owner-primary" onClick={addLine}><Plus size={15} /> Tambah baris</button>
        </div>
        {purchaseMode === 'pack' && selected ? (
          <p className="owner-muted">1 {selected.purchaseUnit} = {selected.usagePerPurchaseUnit} {selected.unit} • {money(selected.purchasePrice)}. {enteredQty > 0 && <>Hasil: {packUsage} {selected.unit} • {money(packCost)}.</>}</p>
        ) : (
          <p className="owner-muted">Biaya boleh dikosongkan untuk memakai estimasi {money(estimated)}{selected ? ` (${selected.usagePerPurchaseUnit} ${selected.unit} per ${selected.purchaseUnit})` : ''}.</p>
        )}

        {draft.length > 0 && (
          <div className="owner-table-wrap">
            <table className="owner-data">
              <thead><tr><th>Bahan</th><th>Jumlah</th><th>Biaya</th><th>Catatan</th><th /></tr></thead>
              <tbody>
                {draft.map((line) => {
                  const ingredient = store.ingredients.find((item) => item.id === line.ingredientId)
                  return <tr key={line.id}>
                    <td><strong>{ingredient?.name ?? 'Bahan dihapus'}</strong></td>
                    <td>
                      {line.mode === 'pack'
                        ? <><strong>{line.enteredQty} {ingredient?.purchaseUnit ?? 'pack'}</strong><span className="owner-cell-sub">= {line.qty} {ingredient?.unit ?? ''}</span></>
                        : `${line.qty} ${ingredient?.unit ?? ''}`}
                    </td>
                    <td>{money(line.totalCost)}</td>
                    <td className="owner-cell-muted">{line.note}</td>
                    <td><button className="icon-danger" aria-label={`Hapus baris ${ingredient?.name ?? ''}`} onClick={() => setDraft((current) => current.filter((item) => item.id !== line.id))}><Trash2 size={14} /></button></td>
                  </tr>
                })}
              </tbody>
            </table>
            <div className="purchase-total">
              <div><span>Total pembelian</span><strong>{money(draftTotal)}</strong></div>
              <button className="owner-ghost" onClick={() => setDraft([])}>Kosongkan</button>
              <button className="owner-primary" onClick={saveDraft}><PackagePlus size={15} /> Simpan {draft.length} pembelian</button>
            </div>
          </div>
        )}
      </section>

      <section className="owner-panel">
        <div className="owner-panel-head">
          <div><h2>Opname stok</h2><p className="owner-muted">Hitung stok fisik lalu simpan selisihnya. Nilai selisih otomatis masuk jurnal persediaan; stok sistem dan biaya satuan menjadi snapshot saat penghitungan.</p></div>
          <div className="owner-panel-actions">
            <span className="owner-count">{opnames.length} catatan</span>
            <button className="owner-primary" onClick={() => setOpnameEditing('new')}><ClipboardCheck size={15} /> Opname baru</button>
          </div>
        </div>
        {opnames.length === 0 ? (
          <p className="owner-muted">Belum ada opname. Lakukan hitung fisik untuk menyesuaikan stok dan melihat selisih.</p>
        ) : (
          <div className="owner-opname-list">
            {opnames.map((movement) => {
              const ingredient = store.ingredients.find((item) => item.id === movement.ingredientId)
              const unit = ingredient?.unit ?? 'unit'
              const system = movement.systemQty ?? 0
              const counted = movement.countedQty ?? 0
              const diff = movement.qty
              const value = Math.round(Math.abs(diff) * (movement.unitCost ?? ingredient?.costPerUnit ?? 0) * 100) / 100
              return (
                <div className="owner-opname-row" key={movement.id}>
                  <div className="owner-opname-main">
                    <strong>{ingredient?.name ?? 'Bahan dihapus'}</strong>
                    <span>{new Date(movement.createdAt).toLocaleString('id-ID')} • {movement.note}</span>
                  </div>
                  <div className="owner-opname-numbers">
                    <span>Sistem {Number.isInteger(system) ? system : system.toFixed(2)} {unit}</span>
                    <span>Fisik {Number.isInteger(counted) ? counted : counted.toFixed(2)} {unit}</span>
                    <span>Nilai {money(value)}</span>
                  </div>
                  <span className={diff === 0 ? 'owner-pill ok' : diff < 0 ? 'owner-pill danger' : 'owner-pill warn'}>{diff > 0 ? '+' : ''}{Number.isInteger(diff) ? diff : diff.toFixed(2)} {unit}</span>
                  <div className="owner-opname-actions">
                    <button className="owner-ghost" onClick={() => setOpnameEditing(movement)}><Pencil size={13} /> Edit</button>
                    <button className="owner-ghost danger" onClick={() => setPendingOpnameDelete(movement)}><Trash2 size={13} /> Hapus</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="owner-panel">
        <div className="owner-panel-head">
          <div><h2>Bahan baku</h2><p className="owner-muted">{store.ingredients.length} bahan • stok dihitung dari pembelian, penyesuaian, dan pemakaian resep.</p></div>
          <div className="owner-panel-actions">
            <button className="owner-ghost" onClick={openStandards}><Ruler size={15} /> Atur standar</button>
            <button className="owner-primary" onClick={() => setEditing('new')}><Plus size={15} /> Bahan baru</button>
          </div>
        </div>
        <div className="owner-toolbar">
          <label className="owner-search">
            <Search size={15} />
            <input placeholder="Cari bahan…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Cari bahan" />
          </label>
          <select value={activeCategory} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter kategori bahan">
            <option value="Semua">Semua kategori</option>
            {categoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <span className="owner-count">{filteredRows.length} tampil</span>
        </div>

        {filteredRows.length === 0 ? (
          <EmptyState icon={<Boxes size={20} />} title="Bahan tidak ditemukan" hint="Ubah kata kunci atau tambahkan bahan baru." />
        ) : (
          <div className="owner-table-wrap">
            <table className="owner-data">
              <thead><tr><th>Bahan</th><th>Stok</th><th>Min</th><th>Standar</th><th>Terpakai</th><th>HPP / satuan</th><th>Aksi</th></tr></thead>
              <tbody>
                {filteredRows.map((row) => {
                  const ingredient = store.ingredients.find((item) => item.id === row.ingredientId)
                  if (!ingredient) return null
                  return <tr key={row.ingredientId}>
                    <td><strong>{row.name}</strong><span className="owner-cell-sub">{ingredient.category || 'Lainnya'} • {row.unit} • {ingredient.usagePerPurchaseUnit} {row.unit} per {ingredient.purchaseUnit}</span></td>
                    <td><span className={row.stock < row.minStock ? 'owner-pill danger' : 'owner-pill ok'}>{Math.round(row.stock)} {row.unit}</span></td>
                    <td>{Math.round(row.minStock)}</td>
                    <td>{standards[ingredient.id] ? `${standards[ingredient.id]} ${row.unit}` : '—'}</td>
                    <td>{Math.round(row.used)}</td>
                    <td>{money(ingredient.costPerUnit)}</td>
                    <td>
                      <div className="owner-table-actions">
                        <button className="owner-ghost" onClick={() => openAdjust(ingredient)}><SlidersHorizontal size={13} /> Sesuaikan</button>
                        <button className="owner-ghost" onClick={() => setEditing(ingredient)}><Pencil size={13} /> Edit</button>
                        <button className="owner-ghost danger" onClick={() => requestDelete(ingredient)} aria-label={`Hapus bahan ${ingredient.name}`}><Trash2 size={13} /> Hapus</button>
                      </div>
                    </td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing !== null && (
        <IngredientEditor
          store={store}
          setStore={setStore}
          notify={notify}
          ingredient={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {opnameEditing !== null && (
        <OpnameEditor
          key={opnameEditing === 'new' ? 'new' : opnameEditing.id}
          store={store}
          setStore={setStore}
          notify={notify}
          opname={opnameEditing === 'new' ? null : opnameEditing}
          onClose={() => setOpnameEditing(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          eyebrow="HAPUS BAHAN"
          title={`Hapus bahan "${pendingDelete.ingredient.name}"?`}
          description={pendingDelete.usedBy.length > 0
            ? `Bahan ini dipakai ${pendingDelete.usedBy.length} menu: ${pendingDelete.usedBy.slice(0, 3).join(', ')}${pendingDelete.usedBy.length > 3 ? ', …' : ''}. Menghapus bahan akan melepasnya dari resep menu tersebut sehingga HPP menu ikut berubah. Riwayat pembelian, opname, dan transaksi tetap tersimpan.`
            : 'Riwayat pembelian, opname, dan transaksi tetap tersimpan.'}
          confirmLabel={pendingDelete.usedBy.length > 0 ? 'Hapus & lepas dari resep' : 'Hapus bahan'}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingOpnameDelete && (
        <ConfirmDialog
          eyebrow="HAPUS OPNAME"
          title={`Hapus catatan opname ${store.ingredients.find((item) => item.id === pendingOpnameDelete.ingredientId)?.name ?? 'bahan'}?`}
          description="Catatan opname dihapus dan stok kembali ke posisi sebelum opname ini. Nilai selisih di laporan persediaan ikut hilang; riwayat pembelian tidak berubah."
          confirmLabel="Hapus catatan opname"
          onConfirm={deleteOpname}
          onCancel={() => setPendingOpnameDelete(null)}
        />
      )}

      {standardOpen && (
        <Modal eyebrow="PEMAKAIAN STANDAR" title="Atur pemakaian standar" onClose={() => setStandardOpen(false)} wide>
          <p className="owner-muted">Isi gramasi/potongan yang biasa dipakai per porsi. Nilai ini otomatis mengisi jumlah bahan saat Anda menambahkannya ke resep menu. Kosongkan sel untuk menghapus standar bahan.</p>
          <label className="owner-search standard-search">
            <Search size={15} />
            <input placeholder="Cari bahan…" value={standardQuery} onChange={(event) => setStandardQuery(event.target.value)} aria-label="Cari bahan standar" />
          </label>
          <div className="standard-list">
            {standardRows.length === 0
              ? <p className="owner-muted standard-empty">Bahan tidak ditemukan.</p>
              : standardRows.map((ingredient) => (
                <label className="standard-row" key={ingredient.id}>
                  <span>
                    <strong>{ingredient.name}</strong>
                    <small>{ingredient.category || 'Lainnya'} • {standards[ingredient.id] ? `standar kini ${standards[ingredient.id]} ${ingredient.unit}` : 'belum ada standar'}</small>
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={standardDraft[ingredient.id] ?? ''}
                    onChange={(event) => setStandardDraft((current) => ({ ...current, [ingredient.id]: event.target.value }))}
                    aria-label={`Standar ${ingredient.name}`}
                    placeholder="—"
                  />
                  <span className="standard-unit">{ingredient.unit}</span>
                </label>
              ))}
          </div>
          <div className="editor-actions">
            <span className="owner-muted standard-count">{standardFilled} bahan terisi</span>
            <span className="editor-spacer" />
            <button className="owner-ghost" onClick={() => setStandardOpen(false)}>Batal</button>
            <button className="owner-primary" onClick={saveStandards}>Simpan standar</button>
          </div>
        </Modal>
      )}

      {adjusting && (
        <Modal eyebrow="PENYESUAIAN STOK" title={adjusting.name} onClose={() => setAdjusting(null)}>
          <p className="owner-muted">Gunakan angka positif untuk stok masuk dan negatif untuk stok keluar (waste, rusak, atau koreksi hitung).</p>
          <Field label={`Jumlah (${adjusting.unit})`} hint="Contoh: 12 atau -3"><input type="number" step="0.1" value={adjustQty} onChange={(event) => setAdjustQty(event.target.value)} autoFocus /></Field>
          <Field label="Catatan"><input value={adjustNote} onChange={(event) => setAdjustNote(event.target.value)} placeholder="mis. stok opname / bahan rusak" /></Field>
          <div className="editor-actions">
            <span className="editor-spacer" />
            <button className="owner-ghost" onClick={() => setAdjusting(null)}>Batal</button>
            <button className="owner-primary" onClick={saveAdjust}>Simpan penyesuaian</button>
          </div>
        </Modal>
      )}
    </>
  )
}
