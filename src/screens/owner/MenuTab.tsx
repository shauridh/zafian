import { useMemo, useState } from 'react'
import { Eye, EyeOff, Pencil, Plus, Search, UtensilsCrossed } from 'lucide-react'

import type { Menu } from '../../domain/catalog'
import { menuMargin } from '../../domain/catalog'
import { createId } from '../../lib/id'
import { MenuThumb } from '../../components/MenuThumb'
import type { OwnerTabProps } from './types'
import { EmptyState, money } from './ui'
import { MenuEditor } from './MenuEditor'

export function MenuTab({ store, setStore, notify }: OwnerTabProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Semua')
  const [editing, setEditing] = useState<Menu | 'new' | null>(null)

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return store.menus.filter((menu) => {
      const matchCategory = category === 'Semua' || menu.category === category
      const matchTerm = !term || menu.name.toLowerCase().includes(term) || menu.category.toLowerCase().includes(term)
      return matchCategory && matchTerm
    })
  }, [store.menus, query, category])

  const toggle = (menu: Menu) => {
    setStore((current) => ({
      ...current,
      menus: current.menus.map((item) => item.id === menu.id ? { ...item, active: !item.active } : item),
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'menu_update' as const, detail: `${menu.name} • ${menu.active ? 'nonaktif' : 'aktif'}` }],
    }))
    notify(`${menu.name} ${menu.active ? 'dinonaktifkan' : 'diaktifkan'}`)
  }

  return (
    <>
      <section className="owner-panel">
        <div className="owner-panel-head">
          <div>
            <h2>Katalog menu</h2>
            <p className="owner-muted">{store.menus.length} menu • {store.menus.filter((menu) => menu.active).length} aktif di kasir. HPP dihitung otomatis dari resep.</p>
          </div>
          <button className="owner-primary" onClick={() => setEditing('new')}><Plus size={15} /> Menu baru</button>
        </div>

        <div className="owner-toolbar">
          <label className="owner-search">
            <Search size={15} />
            <input placeholder="Cari nama atau kategori…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Cari menu" />
          </label>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter kategori">
            <option value="Semua">Semua kategori</option>
            {store.categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </select>
          <span className="owner-count">{filtered.length} tampil</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<UtensilsCrossed size={20} />}
            title="Menu tidak ditemukan"
            hint={store.menus.length === 0 ? 'Tambahkan menu pertama untuk mulai berjualan.' : 'Ubah kata kunci atau filter kategori.'}
            action={<button className="owner-primary" onClick={() => setEditing('new')}><Plus size={15} /> Menu baru</button>}
          />
        ) : (
          <div className="owner-menu-grid">
            {filtered.map((menu) => {
              const metric = menuMargin(menu, store.ingredients)
              return (
                <article className={menu.active ? 'owner-menu-card' : 'owner-menu-card is-off'} key={menu.id}>
                  <button className="owner-menu-photo" onClick={() => setEditing(menu)} aria-label={`Ubah ${menu.name}`}>
                    <MenuThumb name={menu.name} emoji={menu.emoji} imageUrl={menu.imageUrl} />
                    <span className={menu.active ? 'owner-badge live' : 'owner-badge off'}>{menu.active ? 'Aktif' : 'Nonaktif'}</span>
                  </button>
                  <div className="owner-menu-body">
                    <div><strong>{menu.name}</strong><span>{menu.category}</span></div>
                    <b>{money(menu.price)}</b>
                  </div>
                  <div className="owner-menu-meta">
                    <span>HPP {money(metric.hpp)}</span>
                    <span className={metric.margin >= 0 ? 'ok' : 'bad'}>Margin {metric.marginPct.toFixed(0)}%</span>
                  </div>
                  <div className="owner-menu-actions">
                    <button onClick={() => setEditing(menu)}><Pencil size={13} /> Edit</button>
                    <button onClick={() => toggle(menu)}>{menu.active ? <EyeOff size={13} /> : <Eye size={13} />}{menu.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {editing !== null && (
        <MenuEditor
          store={store}
          setStore={setStore}
          notify={notify}
          menu={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
