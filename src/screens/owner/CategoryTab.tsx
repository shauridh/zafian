import { useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Tags, Trash2 } from 'lucide-react'

import type { Category } from '../../domain/catalog'
import { createId } from '../../lib/id'
import type { OwnerTabProps } from './types'
import { ConfirmDialog, EmptyState, Field, Modal } from './ui'

type CategorySectionProps = {
  title: string
  description: string
  unitLabel: 'menu' | 'bahan'
  placeholder: string
  inputLabel: string
  emptyHint: string
  footer: string
  categories: Category[]
  countFor: (name: string) => number
  notify: (message: string) => void
  onAdd: (name: string) => void
  onRename: (category: Category, name: string) => void
  onRemove: (category: Category) => void
  onMove: (index: number, direction: -1 | 1) => void
}

function CategorySection({
  title,
  description,
  unitLabel,
  placeholder,
  inputLabel,
  emptyHint,
  footer,
  categories,
  countFor,
  notify,
  onAdd,
  onRename,
  onRemove,
  onMove,
}: CategorySectionProps) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<Category | null>(null)
  const [draftName, setDraftName] = useState('')
  const [pendingRemove, setPendingRemove] = useState<Category | null>(null)

  const duplicate = (name: string, ignoreId?: string) =>
    categories.some((category) => category.id !== ignoreId && category.name.toLowerCase() === name.toLowerCase())

  const add = () => {
    const name = newName.trim()
    if (!name) { notify('Nama kategori wajib diisi'); return }
    if (duplicate(name)) { notify('Kategori sudah ada'); return }
    onAdd(name)
    setNewName('')
  }

  const rename = () => {
    if (!editing) return
    const name = draftName.trim()
    if (!name) { notify('Nama kategori wajib diisi'); return }
    if (duplicate(name, editing.id)) { notify('Kategori sudah ada'); return }
    onRename(editing, name)
    setEditing(null)
  }

  const remove = (category: Category) => {
    const used = countFor(category.name)
    if (used > 0) { notify(`Pindahkan ${used} ${unitLabel} dari kategori ini terlebih dahulu`); return }
    if (categories.length <= 1) { notify('Minimal satu kategori harus tersedia'); return }
    setPendingRemove(category)
  }

  const confirmRemove = () => {
    if (!pendingRemove) return
    onRemove(pendingRemove)
    setPendingRemove(null)
  }

  return (
    <>
      <section className="owner-panel">
        <div className="owner-panel-head">
          <div>
            <h2>{title}</h2>
            <p className="owner-muted">{description}</p>
          </div>
        </div>
        <div className="owner-inline-form">
          <input
            placeholder={placeholder}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') add() }}
            aria-label={inputLabel}
          />
          <button className="owner-primary" onClick={add}><Plus size={15} /> Tambah kategori</button>
        </div>

        {categories.length === 0 ? (
          <EmptyState icon={<Tags size={20} />} title="Belum ada kategori" hint={emptyHint} />
        ) : (
          <div className="owner-category-list">
            {categories.map((category, index) => {
              const count = countFor(category.name)
              return (
                <div className="owner-category-row" key={category.id}>
                  <span className="owner-category-icon"><Tags size={16} /></span>
                  <div><strong>{category.name}</strong><small>{count} {unitLabel}</small></div>
                  <div className="owner-category-order">
                    <button aria-label={`Naikkan ${category.name}`} disabled={index === 0} onClick={() => onMove(index, -1)}><ArrowUp size={14} /></button>
                    <button aria-label={`Turunkan ${category.name}`} disabled={index === categories.length - 1} onClick={() => onMove(index, 1)}><ArrowDown size={14} /></button>
                  </div>
                  <div className="owner-category-actions">
                    <button className="owner-ghost" onClick={() => { setEditing(category); setDraftName(category.name) }}><Pencil size={13} /> Ubah</button>
                    <button className="owner-ghost danger" onClick={() => remove(category)} disabled={count > 0} title={count > 0 ? `Kategori masih dipakai ${unitLabel}` : 'Hapus kategori'}><Trash2 size={13} /> Hapus</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className="owner-muted">{footer}</p>
      </section>

      {pendingRemove && (
        <ConfirmDialog
          eyebrow="HAPUS KATEGORI"
          title={`Hapus kategori "${pendingRemove.name}"?`}
          description={`Kategori dihapus dari daftar kategori ${unitLabel}. Tidak ada ${unitLabel} yang memakai kategori ini, jadi data ${unitLabel} tidak berubah.`}
          confirmLabel="Hapus kategori"
          onConfirm={confirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {editing && (
        <Modal eyebrow="UBAH KATEGORI" title={editing.name} onClose={() => setEditing(null)}>
          <Field label="Nama kategori"><input value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') rename() }} /></Field>
          <p className="owner-muted">{countFor(editing.name)} {unitLabel} akan ikut memakai nama kategori baru.</p>
          <div className="editor-actions">
            <span className="editor-spacer" />
            <button className="owner-ghost" onClick={() => setEditing(null)}>Batal</button>
            <button className="owner-primary" onClick={rename}>Simpan</button>
          </div>
        </Modal>
      )}
    </>
  )
}

export function CategoryTab({ store, setStore, notify }: OwnerTabProps) {
  const menuCount = (name: string) => store.menus.filter((menu) => menu.category === name).length
  const ingredientCount = (name: string) => store.ingredients.filter((ingredient) => (ingredient.category || 'Lainnya') === name).length

  const addMenuCategory = (name: string) => {
    setStore((current) => ({
      ...current,
      categories: [...current.categories, { id: createId(), name }],
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'category_update' as const, detail: `Kategori menu ${name} ditambahkan` }],
    }))
    notify(`Kategori ${name} ditambahkan`)
  }

  const renameMenuCategory = (category: Category, name: string) => {
    setStore((current) => ({
      ...current,
      categories: current.categories.map((item) => item.id === category.id ? { ...item, name } : item),
      menus: current.menus.map((menu) => menu.category === category.name ? { ...menu, category: name } : menu),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'category_update' as const, detail: `Kategori menu ${category.name} → ${name}` }],
    }))
    notify(`Kategori diubah menjadi ${name}`)
  }

  const removeMenuCategory = (category: Category) => {
    setStore((current) => ({
      ...current,
      categories: current.categories.filter((item) => item.id !== category.id),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'category_update' as const, detail: `Kategori menu ${category.name} dihapus` }],
    }))
    notify(`Kategori ${category.name} dihapus`)
  }

  const moveMenuCategory = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= store.categories.length) return
    setStore((current) => {
      const categories = [...current.categories]
      const [item] = categories.splice(index, 1)
      categories.splice(target, 0, item)
      return { ...current, categories }
    })
  }

  const addIngredientCategory = (name: string) => {
    setStore((current) => ({
      ...current,
      ingredientCategories: [...(current.ingredientCategories ?? []), { id: createId(), name }],
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'category_update' as const, detail: `Kategori bahan ${name} ditambahkan` }],
    }))
    notify(`Kategori bahan ${name} ditambahkan`)
  }

  const renameIngredientCategory = (category: Category, name: string) => {
    setStore((current) => ({
      ...current,
      ingredientCategories: (current.ingredientCategories ?? []).map((item) => item.id === category.id ? { ...item, name } : item),
      ingredients: current.ingredients.map((ingredient) => (ingredient.category || 'Lainnya') === category.name ? { ...ingredient, category: name } : ingredient),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'category_update' as const, detail: `Kategori bahan ${category.name} → ${name}` }],
    }))
    notify(`Kategori bahan diubah menjadi ${name}`)
  }

  const removeIngredientCategory = (category: Category) => {
    setStore((current) => ({
      ...current,
      ingredientCategories: (current.ingredientCategories ?? []).filter((item) => item.id !== category.id),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'category_update' as const, detail: `Kategori bahan ${category.name} dihapus` }],
    }))
    notify(`Kategori bahan ${category.name} dihapus`)
  }

  const moveIngredientCategory = (index: number, direction: -1 | 1) => {
    const categories = store.ingredientCategories ?? []
    const target = index + direction
    if (target < 0 || target >= categories.length) return
    setStore((current) => {
      const next = [...(current.ingredientCategories ?? [])]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return { ...current, ingredientCategories: next }
    })
  }

  return (
    <>
      <CategorySection
        title="Kategori menu"
        description="Urutan kategori ini juga menjadi urutan tab di kasir. Kategori yang masih dipakai menu tidak dapat dihapus."
        unitLabel="menu"
        placeholder="Nama kategori menu baru, mis. Minuman"
        inputLabel="Nama kategori baru"
        emptyHint="Tambahkan kategori agar menu bisa dikelompokkan di kasir."
        footer="Kategori yang masih dipakai menu tidak dapat dihapus. Pindahkan menunya lewat tab Menu & HPP."
        categories={store.categories}
        countFor={menuCount}
        notify={notify}
        onAdd={addMenuCategory}
        onRename={renameMenuCategory}
        onRemove={removeMenuCategory}
        onMove={moveMenuCategory}
      />
      <CategorySection
        title="Kategori bahan"
        description="Kelompokkan bahan baku agar stok mudah difilter saat pembelian, penyesuaian, dan opname."
        unitLabel="bahan"
        placeholder="Nama kategori bahan baru, mis. Bumbu kering"
        inputLabel="Nama kategori bahan baru"
        emptyHint="Tambahkan kategori agar bahan bisa difilter di tab Bahan & stok."
        footer="Kategori yang masih dipakai bahan tidak dapat dihapus. Pindahkan bahannya lewat editor bahan."
        categories={store.ingredientCategories ?? []}
        countFor={ingredientCount}
        notify={notify}
        onAdd={addIngredientCategory}
        onRename={renameIngredientCategory}
        onRemove={removeIngredientCategory}
        onMove={moveIngredientCategory}
      />
    </>
  )
}
