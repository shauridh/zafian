import { useState, type Dispatch, type SetStateAction } from 'react'
import { Trash2 } from 'lucide-react'

import type { StockMovement } from '../../domain/inventory'
import { inventoryRows } from '../../domain/inventory'
import type { PosStore } from '../../domain/pos'
import { createId } from '../../lib/id'
import { ConfirmDialog, Field, Modal, money } from './ui'

type Props = {
  store: PosStore
  setStore: Dispatch<SetStateAction<PosStore>>
  notify: (message: string) => void
  opname: StockMovement | null
  onClose: () => void
}

const formatQty = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2)

export function OpnameEditor({ store, setStore, notify, opname, onClose }: Props) {
  const initialIngredientId = opname?.ingredientId ?? store.ingredients[0]?.id ?? ''
  const [ingredientId, setIngredientId] = useState(initialIngredientId)
  const [counted, setCounted] = useState(opname && typeof opname.countedQty === 'number' ? String(opname.countedQty) : '')
  const [note, setNote] = useState(opname?.note ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const rows = inventoryRows(store.ingredients, store.menus, store.transactions, store.stockMovements)
  const ingredient = store.ingredients.find((item) => item.id === ingredientId)
  const currentSystem = rows.find((row) => row.ingredientId === ingredientId)?.stock ?? 0
  // Saat mengubah opname lama, pakai snapshot sistem agar selisih tidak berubah
  // hanya karena ada pembelian/penjualan setelah penghitungan.
  const systemQty = opname ? opname.systemQty ?? 0 : currentSystem
  const unit = ingredient?.unit ?? 'unit'
  // Snapshot biaya saat opname dibuat; edit memakai snapshot lama agar nilai jurnal tidak bergeser.
  const unitCost = opname?.unitCost ?? ingredient?.costPerUnit ?? 0
  const countedValue = Number(counted)
  const rawDifference = Number.isFinite(countedValue) ? countedValue - systemQty : 0
  const difference = Math.abs(rawDifference) < 0.0001 ? 0 : rawDifference
  const differenceClass = difference === 0 ? 'ok' : difference < 0 ? 'bad' : 'warn'
  const adjustmentValue = Math.round(Math.abs(difference) * unitCost * 100) / 100

  const save = () => {
    if (!ingredient) { notify('Pilih bahan yang dihitung'); return }
    if (!Number.isFinite(countedValue) || countedValue < 0) { notify('Stok fisik tidak valid'); return }
    const noteText = note.trim() || 'Opname stok'
    const createdAt = new Date().toISOString()
    if (opname) {
      setStore((current) => ({
        ...current,
        stockMovements: current.stockMovements.map((movement) => movement.id === opname.id
          ? { ...movement, qty: countedValue - systemQty, countedQty: countedValue, unitCost, note: noteText }
          : movement),
        auditLog: [...current.auditLog, { id: createId(), createdAt, action: 'opname' as const, detail: `${ingredient.name}: ${formatQty(systemQty)} → ${formatQty(countedValue)} ${unit}` }],
      }))
      notify(`Opname ${ingredient.name} diperbarui`)
    } else {
      const movement: StockMovement = {
        id: createId(),
        createdAt,
        ingredientId: ingredient.id,
        type: 'opname',
        qty: countedValue - systemQty,
        totalCost: 0,
        unitCost,
        note: noteText,
        countedQty: countedValue,
        systemQty,
      }
      setStore((current) => ({
        ...current,
        stockMovements: [...current.stockMovements, movement],
        auditLog: [...current.auditLog, { id: createId(), createdAt, action: 'opname' as const, detail: `${ingredient.name}: ${formatQty(systemQty)} → ${formatQty(countedValue)} ${unit}` }],
      }))
      notify(`Opname ${ingredient.name} tersimpan`)
    }
    onClose()
  }

  const remove = () => {
    if (!opname || !ingredient) return
    setStore((current) => ({
      ...current,
      stockMovements: current.stockMovements.filter((movement) => movement.id !== opname.id),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'opname' as const, detail: `Hapus opname ${ingredient.name}` }],
    }))
    notify(`Opname ${ingredient.name} dihapus`)
    onClose()
  }

  return (
    <Modal eyebrow={opname ? 'UBAH OPNAME' : 'OPNAME STOK'} title={opname ? 'Ubah hasil hitung' : 'Hitung stok fisik'} onClose={onClose}>
      <Field label="Bahan" hint={opname ? 'Bahan tidak dapat diubah saat mengedit opname.' : 'Pilih bahan yang sedang dihitung.'}>
        <select aria-label="Bahan opname" value={ingredientId} disabled={Boolean(opname)} onChange={(event) => { setIngredientId(event.target.value); setCounted('') }}>
          {store.ingredients.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
        </select>
      </Field>

      <div className="opname-grid">
        <div className="opname-stat">
          <span>Stok sistem</span>
          <strong>{formatQty(systemQty)} {unit}</strong>
          <small>{opname ? 'Snapshot saat opname' : 'Saat ini'}</small>
        </div>
        <Field label={`Stok fisik (${unit})`}>
          <input aria-label="Stok fisik" type="number" min="0" step="0.01" value={counted} onChange={(event) => setCounted(event.target.value)} autoFocus />
        </Field>
        <div className="opname-stat">
          <span>Selisih</span>
          <strong className={`opname-diff ${differenceClass}`}>{difference > 0 ? '+' : ''}{formatQty(difference)} {unit}</strong>
          <small>{difference === 0 ? 'Stok sesuai' : difference < 0 ? 'Stok fisik lebih rendah' : 'Stok fisik lebih tinggi'}</small>
        </div>
      </div>

      <Field label="Catatan" hint="Mis. opname akhir shift, bahan rusak, atau koreksi hitung.">
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opname akhir shift" />
      </Field>

      <p className="owner-muted">
        {difference === 0
          ? `Tidak ada nilai yang dijurnal karena stok fisik sudah sesuai. Biaya acuan ${money(unitCost)} per ${unit}.`
          : `Nilai penyesuaian ${money(adjustmentValue)} (${formatQty(Math.abs(difference))} ${unit} × ${money(unitCost)}) otomatis masuk jurnal: Persediaan Bahan dan Selisih Persediaan.`}
      </p>

      <div className="editor-actions">
        {opname && <button className="owner-ghost danger" onClick={() => setConfirmingDelete(true)}><Trash2 size={14} /> Hapus opname</button>}
        <span className="editor-spacer" />
        <button className="owner-ghost" onClick={onClose}>Batal</button>
        <button className="owner-primary" onClick={save}>{opname ? 'Simpan perubahan' : 'Simpan opname'}</button>
      </div>

      {confirmingDelete && opname && ingredient && (
        <ConfirmDialog
          eyebrow="HAPUS OPNAME"
          title={`Hapus opname ${ingredient.name}?`}
          description="Stok kembali ke posisi sebelum opname ini dan nilai selisih di laporan persediaan ikut hilang. Riwayat pembelian tidak berubah; tindakan ini tidak bisa dibatalkan."
          confirmLabel="Hapus catatan opname"
          onConfirm={remove}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </Modal>
  )
}
