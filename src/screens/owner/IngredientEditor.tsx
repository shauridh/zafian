import { useState, type Dispatch, type SetStateAction } from 'react'
import { Calculator, Trash2 } from 'lucide-react'

import type { Ingredient } from '../../domain/catalog'
import type { PosStore } from '../../domain/pos'
import { createId } from '../../lib/id'
import { Field, Modal, money } from './ui'

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
  const [purchasePrice, setPurchasePrice] = useState(ingredient ? String(ingredient.purchasePrice) : '')
  const [usage, setUsage] = useState(ingredient ? String(ingredient.usagePerPurchaseUnit) : '')
  const [costPerUnit, setCostPerUnit] = useState(ingredient ? String(ingredient.costPerUnit) : '')
  const [minStock, setMinStock] = useState(ingredient ? String(ingredient.minStock) : '')

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
    if (usedBy.length > 0) {
      notify(`Bahan masih dipakai ${usedBy.length} menu: ${usedBy.slice(0, 2).map((menu) => menu.name).join(', ')}`)
      return
    }
    if (!window.confirm(`Hapus bahan "${ingredient.name}"? Riwayat pembelian tetap tersimpan.`)) return
    setStore((current) => ({
      ...current,
      ingredients: current.ingredients.filter((item) => item.id !== ingredient.id),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'ingredient_delete' as const, detail: ingredient.name }],
    }))
    notify(`${ingredient.name} dihapus`)
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
        <Field label="Satuan pakai" hint="dipakai di resep, mis. gram / potong / ml"><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="gram" /></Field>
      </div>
      <div className="owner-field-grid">
        <Field label="Satuan pembelian"><input value={purchaseUnit} onChange={(event) => setPurchaseUnit(event.target.value)} placeholder="pack 500 gram" /></Field>
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
        {ingredient && <button className="owner-ghost danger" onClick={remove} disabled={usedBy.length > 0} title={usedBy.length > 0 ? 'Bahan masih dipakai resep menu' : 'Hapus bahan'}><Trash2 size={14} /> Hapus</button>}
        <span className="editor-spacer" />
        <button className="owner-ghost" onClick={onClose}>Batal</button>
        <button className="owner-primary" onClick={save}>{ingredient ? 'Simpan' : 'Tambah bahan'}</button>
      </div>
    </Modal>
  )
}
