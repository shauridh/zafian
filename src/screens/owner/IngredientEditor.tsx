import { useState, type Dispatch, type SetStateAction } from 'react'
import { Calculator, Trash2 } from 'lucide-react'

import type { Ingredient } from '../../domain/catalog'
import type { PosStore } from '../../domain/pos'
import { unitOptionsWithCurrent } from '../../domain/units'
import { removeIngredient } from '../../lib/catalog-ops'
import { createId } from '../../lib/id'
import { ConfirmDialog, Field, Modal, money } from './ui'

type Props = {
  store: PosStore
  setStore: Dispatch<SetStateAction<PosStore>>
  notify: (message: string) => void
  ingredient: Ingredient | null
  onClose: () => void
}

export function IngredientEditor({ store, setStore, notify, ingredient, onClose }: Props) {
  const categoryNames = [...new Set([...(store.ingredientCategories ?? []).map((item) => item.name), ingredient?.category ?? 'Lainnya'])]
  const [name, setName] = useState(ingredient?.name ?? '')
  const [category, setCategory] = useState(ingredient?.category ?? categoryNames[0] ?? 'Lainnya')
  const [unit, setUnit] = useState(ingredient?.unit ?? '')
  const [purchaseUnit, setPurchaseUnit] = useState(ingredient?.purchaseUnit ?? '')
  const unitChoices = unitOptionsWithCurrent(unit)
  const purchaseUnitChoices = unitOptionsWithCurrent(purchaseUnit)
  const [purchasePrice, setPurchasePrice] = useState(ingredient ? String(ingredient.purchasePrice) : '')
  const [usage, setUsage] = useState(ingredient ? String(ingredient.usagePerPurchaseUnit) : '')
  const [costPerUnit, setCostPerUnit] = useState(ingredient ? String(ingredient.costPerUnit) : '')
  const [minStock, setMinStock] = useState(ingredient ? String(ingredient.minStock) : '')
  const [confirming, setConfirming] = useState(false)

  const priceValue = Number(purchasePrice) || 0
  const usageValue = Number(usage) || 0
  const computed = usageValue > 0 ? priceValue / usageValue : 0
  const usedBy = ingredient ? store.menus.filter((menu) => menu.recipe.some((line) => line.ingredientId === ingredient.id)) : []

  const save = () => {
    const cleanName = name.trim()
    if (!cleanName) { notify('Nama bahan wajib diisi'); return }
    if (!unit.trim()) { notify('Satuan pakai wajib diisi'); return }
    if (!Number.isFinite(Number(purchasePrice)) || Number(purchasePrice) < 0) { notify('Harga beli tidak valid'); return }
    if (!Number.isFinite(Number(usage)) || Number(usage) <= 0) { notify('Isi per pembelian harus lebih dari 0'); return }
    const costValue = costPerUnit.trim() === '' ? computed : Number(costPerUnit)
    if (!Number.isFinite(costValue) || costValue < 0) { notify('Biaya per satuan tidak valid'); return }
    const payload: Ingredient = {
      id: ingredient?.id ?? createId(),
      name: cleanName,
      category: category.trim() || 'Lainnya',
      unit: unit.trim(),
      purchaseUnit: purchaseUnit.trim() || unit.trim(),
      purchasePrice: Math.max(0, Number(purchasePrice) || 0),
      usagePerPurchaseUnit: Math.max(0.0001, Number(usage) || 1),
      costPerUnit: Math.max(0, costValue || 0),
      minStock: Math.max(0, Number(minStock) || 0),
    }
    setStore((current) => ({
      ...current,
      ingredients: ingredient ? current.ingredients.map((item) => item.id === ingredient.id ? payload : item) : [...current.ingredients, payload],
      auditLog: [...current.auditLog, {
        id: createId(),
        createdAt: new Date().toISOString(),
        action: ingredient ? 'ingredient_update' as const : 'ingredient_create' as const,
        detail: `${cleanName} • ${money(payload.costPerUnit)}/${payload.unit}`,
      }],
    }))
    notify(ingredient ? `${cleanName} diperbarui` : `${cleanName} ditambahkan`)
    onClose()
  }

  const remove = () => {
    if (!ingredient) return
    setStore((current) => removeIngredient(current, ingredient).store)
    notify(usedBy.length > 0 ? `${ingredient.name} dihapus • dilepas dari ${usedBy.length} resep` : `${ingredient.name} dihapus`)
    setConfirming(false)
    onClose()
  }

  return (
    <Modal eyebrow={ingredient ? 'UBAH BAHAN' : 'BAHAN BARU'} title={ingredient ? ingredient.name : 'Tambah bahan baku'} onClose={onClose}>
      <Field label="Nama bahan"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="mis. Saus keju mentai" /></Field>
      <div className="owner-field-grid">
        <Field label="Kategori bahan" hint="Dipakai untuk filter di tab Bahan & stok.">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categoryNames.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Satuan pakai" hint="Dipakai di resep, mis. gram / potong / ml.">
          <select value={unit} onChange={(event) => setUnit(event.target.value)} aria-label="Satuan pakai">
            <option value="">Pilih satuan</option>
            {unitChoices.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
      </div>
      <div className="owner-field-grid">
        <Field label="Satuan pembelian" hint="Satuan kemasan saat membeli; konversi diisi di kolom isi.">
          <select value={purchaseUnit} onChange={(event) => setPurchaseUnit(event.target.value)} aria-label="Satuan pembelian">
            <option value="">{unit ? `Sama dengan satuan pakai (${unit})` : 'Sama dengan satuan pakai'}</option>
            {purchaseUnitChoices.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Harga beli"><input type="number" min="0" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} /></Field>
      </div>
      <div className="owner-field-grid">
        <Field label="Isi per pembelian" hint={`= ${usageValue || 0} ${unit || 'unit'}`}><input type="number" min="0" step="0.01" value={usage} onChange={(event) => setUsage(event.target.value)} /></Field>
        <Field label="Stok minimum" hint="Dipakai untuk peringatan stok rendah dan forecast."><input type="number" min="0" value={minStock} onChange={(event) => setMinStock(event.target.value)} /></Field>
      </div>
      <Field label={`Biaya per ${unit || 'satuan'}`} hint={`Otomatis: ${money(computed)}`}>
        <input type="number" min="0" step="0.01" value={costPerUnit} onChange={(event) => setCostPerUnit(event.target.value)} />
      </Field>
      <button type="button" className="owner-ghost owner-calc" onClick={() => setCostPerUnit(String(Math.round(computed * 100) / 100))}><Calculator size={14} /> Pakai biaya otomatis {money(computed)}</button>
      {ingredient && <p className="owner-muted">Dipakai oleh {usedBy.length} menu{usedBy.length > 0 ? `: ${usedBy.slice(0, 3).map((menu) => menu.name).join(', ')}` : ''}.</p>}
      <div className="editor-actions">
        {ingredient && <button className="owner-ghost danger" onClick={() => setConfirming(true)} title="Hapus bahan"><Trash2 size={14} /> Hapus</button>}
        <span className="editor-spacer" />
        <button className="owner-ghost" onClick={onClose}>Batal</button>
        <button className="owner-primary" onClick={save}>{ingredient ? 'Simpan' : 'Tambah bahan'}</button>
      </div>

      {confirming && ingredient && (
        <ConfirmDialog
          eyebrow="HAPUS BAHAN"
          title={`Hapus bahan "${ingredient.name}"?`}
          description={usedBy.length > 0
            ? `Bahan ini dipakai ${usedBy.length} menu: ${usedBy.slice(0, 3).map((menu) => menu.name).join(', ')}${usedBy.length > 3 ? ', …' : ''}. Menghapus bahan akan melepasnya dari resep menu tersebut sehingga HPP menu ikut berubah. Riwayat pembelian, opname, dan transaksi tetap tersimpan.`
            : 'Riwayat pembelian, opname, dan transaksi tetap tersimpan.'}
          confirmLabel={usedBy.length > 0 ? 'Hapus & lepas dari resep' : 'Hapus bahan'}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Modal>
  )
}
