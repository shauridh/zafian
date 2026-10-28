import { useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import { ImagePlus, Plus, Trash2, X } from 'lucide-react'

import type { Menu, RecipeLine } from '../../domain/catalog'
import type { PosStore } from '../../domain/pos'
import { createId } from '../../lib/id'
import { fileToMenuImage } from '../../lib/image'
import { ConfirmDialog, Field, FieldGroup, Modal, money } from './ui'

type Props = {
  store: PosStore
  setStore: Dispatch<SetStateAction<PosStore>>
  notify: (message: string) => void
  menu: Menu | null
  onClose: () => void
}

export function MenuEditor({ store, setStore, notify, menu, onClose }: Props) {
  const [name, setName] = useState(menu?.name ?? '')
  const [category, setCategory] = useState(menu?.category ?? store.categories[0]?.name ?? 'Lainnya')
  const [price, setPrice] = useState(menu ? String(menu.price) : '')
  const [emoji, setEmoji] = useState(menu?.emoji ?? '🍽️')
  const [imageUrl, setImageUrl] = useState(menu?.imageUrl ?? '')
  const [active, setActive] = useState(menu?.active ?? true)
  const [recipe, setRecipe] = useState<RecipeLine[]>(menu?.recipe.map((line) => ({ ...line })) ?? [])
  const [uploading, setUploading] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const transactionCount = menu
    ? store.transactions.filter((transaction) => transaction.items.some((item) => item.id === menu.id)).length
    : 0

  const priceValue = Number(price) || 0
  const hpp = recipe.reduce((sum, line) => {
    const ingredient = store.ingredients.find((item) => item.id === line.ingredientId)
    return sum + (ingredient ? ingredient.costPerUnit * line.qty : 0)
  }, 0)
  const margin = priceValue - hpp
  const marginPct = priceValue > 0 ? (margin / priceValue) * 100 : 0
  const categoryOptions = store.categories.some((item) => item.name === category) ? store.categories : [...store.categories, { id: 'current', name: category }]

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      setImageUrl(await fileToMenuImage(file))
      setImageFailed(false)
      notify('Foto menu diperbarui')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Gagal memuat gambar')
    } finally {
      setUploading(false)
    }
  }

  const addLine = () => {
    const used = new Set(recipe.map((line) => line.ingredientId))
    const next = store.ingredients.find((item) => !used.has(item.id)) ?? store.ingredients[0]
    if (!next) { notify('Tambahkan bahan baku terlebih dahulu'); return }
    setRecipe((current) => [...current, { ingredientId: next.id, qty: 1 }])
  }

  const updateLine = (index: number, patch: Partial<RecipeLine>) => {
    setRecipe((current) => current.map((line, position) => position === index ? { ...line, ...patch } : line))
  }

  const save = () => {
    const cleanName = name.trim()
    if (!cleanName) { notify('Nama menu wajib diisi'); return }
    if (!Number.isFinite(Number(price)) || Number(price) < 0) { notify('Harga jual tidak valid'); return }
    const merged = new Map<string, number>()
    for (const line of recipe) {
      if (!line.ingredientId || !Number.isFinite(line.qty) || line.qty <= 0) continue
      merged.set(line.ingredientId, (merged.get(line.ingredientId) ?? 0) + line.qty)
    }
    const payload: Menu = {
      id: menu?.id ?? createId(),
      name: cleanName,
      category: category.trim() || store.categories[0]?.name || 'Lainnya',
      price: Math.max(0, Number(price) || 0),
      emoji: emoji.trim() || '🍽️',
      ...(imageUrl ? { imageUrl } : {}),
      active,
      recipe: [...merged.entries()].map(([ingredientId, qty]) => ({ ingredientId, qty })),
    }
    setStore((current) => ({
      ...current,
      menus: menu ? current.menus.map((item) => item.id === menu.id ? payload : item) : [...current.menus, payload],
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: menu ? 'menu_update' as const : 'menu_create' as const, detail: `${cleanName} • ${money(payload.price)}` }],
    }))
    notify(menu ? `${cleanName} diperbarui` : `${cleanName} ditambahkan ke katalog`)
    onClose()
  }

  const remove = () => {
    if (!menu) return
    setStore((current) => ({
      ...current,
      menus: current.menus.filter((item) => item.id !== menu.id),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'menu_delete' as const, detail: menu.name }],
    }))
    notify(`${menu.name} dihapus dari katalog`)
    onClose()
  }

  return (
    <Modal eyebrow={menu ? 'UBAH MENU' : 'MENU BARU'} title={menu ? menu.name : 'Tambah menu'} onClose={onClose} wide>
      <div className="editor-grid">
        <div className="editor-col">
          <div className="image-drop">
            <div className="image-preview">
              {imageUrl && !imageFailed
                ? <img src={imageUrl} alt={`Pratinjau ${name || 'menu'}`} onError={() => setImageFailed(true)} />
                : <span className="image-fallback" role="img" aria-label={imageFailed ? 'Gambar gagal dimuat' : undefined}>{emoji}</span>}
            </div>
            <div className="image-drop-copy">
              <strong>Foto menu</strong>
              <small>Rasio asli dipertahankan. Di kasir gambar tampil utuh, tidak dipotong.</small>
              <div className="image-actions">
                <button className="owner-ghost" type="button" onClick={() => fileRef.current?.click()} disabled={uploading}><ImagePlus size={14} /> {uploading ? 'Memproses…' : 'Unggah foto'}</button>
                {imageUrl && <button className="owner-ghost danger" type="button" onClick={() => { setImageUrl(''); setImageFailed(false) }}><X size={14} /> Hapus foto</button>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => void upload(event)} />
            </div>
          </div>

          <Field label="Nama menu"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="mis. Rice Bowl Sambal Matah" /></Field>
          <div className="owner-field-grid">
            <Field label="Harga jual"><input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="15000" /></Field>
            <Field label="Kategori">
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categoryOptions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="owner-field-grid">
            <Field label="Emoji cadangan" hint="Tampil bila foto belum diunggah."><input value={emoji} maxLength={4} onChange={(event) => setEmoji(event.target.value)} /></Field>
            <FieldGroup label="Status jual">
              <button type="button" className={active ? 'owner-toggle active owner-toggle-wide' : 'owner-toggle owner-toggle-wide'} onClick={() => setActive((value) => !value)}>{active ? 'Aktif di kasir' : 'Nonaktif'}</button>
            </FieldGroup>
          </div>
        </div>

        <div className="editor-col">
          <div className="owner-panel-head">
            <div><h3>Resep & HPP</h3><p className="owner-muted">HPP dihitung otomatis dari harga bahan.</p></div>
          </div>
          <div className="recipe-list">
            {recipe.length === 0 && <p className="owner-muted">Belum ada bahan. Menu tetap bisa dijual tanpa resep, tetapi HPP tercatat Rp0.</p>}
            {recipe.map((line, index) => {
              const ingredient = store.ingredients.find((item) => item.id === line.ingredientId)
              return (
                <div className="recipe-row" key={`${line.ingredientId}-${index}`}>
                  <select value={line.ingredientId} onChange={(event) => updateLine(index, { ingredientId: event.target.value })}>
                    {store.ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <input type="number" min="0" step="0.1" value={line.qty} onChange={(event) => updateLine(index, { qty: Number(event.target.value) || 0 })} aria-label={`Jumlah ${ingredient?.name ?? 'bahan'}`} />
                  <span>{ingredient?.unit ?? 'unit'}</span>
                  <b>{money((ingredient?.costPerUnit ?? 0) * line.qty)}</b>
                  <button type="button" className="icon-danger" aria-label={`Hapus ${ingredient?.name ?? 'bahan'}`} onClick={() => setRecipe((current) => current.filter((_, position) => position !== index))}><Trash2 size={14} /></button>
                </div>
              )
            })}
          </div>
          <button type="button" className="owner-ghost recipe-add" onClick={addLine} disabled={store.ingredients.length === 0}><Plus size={14} /> Tambah bahan</button>
          <div className="hpp-summary">
            <div><span>HPP per porsi</span><b>{money(hpp)}</b></div>
            <div><span>Margin per porsi</span><b className={margin >= 0 ? 'ok' : 'bad'}>{money(margin)} • {marginPct.toFixed(0)}%</b></div>
          </div>
          <p className="owner-muted">Total resep: {recipe.length} bahan. Margin dihitung dari harga jual saat ini.</p>
        </div>
      </div>

      {transactionCount > 0 && (
        <p className="owner-muted menu-usage-note">
          Menu ini pernah muncul di {transactionCount} transaksi. Menghapusnya dari katalog tidak menghapus riwayat transaksi.
        </p>
      )}

      <div className="editor-actions">
        {menu &&        <button className="owner-ghost danger" onClick={() => setConfirmingDelete(true)}><Trash2 size={14} /> Hapus menu</button>}
        <span className="editor-spacer" />
        <button className="owner-ghost" onClick={onClose}>Batal</button>
        <button className="owner-primary" onClick={save}>{menu ? 'Simpan perubahan' : 'Tambah menu'}</button>
      </div>

      {confirmingDelete && menu && (
        <ConfirmDialog
          eyebrow="HAPUS MENU"
          title={`Hapus menu "${menu.name}"?`}
          description={transactionCount > 0
            ? `Menu dihapus dari katalog kasir. Menu ini pernah muncul di ${transactionCount} transaksi dan riwayat transaksi tetap tersimpan.`
            : 'Menu dihapus dari katalog kasir. Belum ada transaksi yang memakai menu ini.'}
          confirmLabel="Hapus dari katalog"
          onConfirm={remove}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </Modal>
  )
}
