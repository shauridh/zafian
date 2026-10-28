import { useMemo } from 'react'
import { AlertTriangle, Boxes, ShoppingCart, TrendingUp } from 'lucide-react'

import { inventoryRows } from '../../domain/inventory'
import type { PosStore } from '../../domain/pos'
import { money } from './ui'

export function ForecastTab({ store }: { store: PosStore }) {
  const rows = useMemo(() => inventoryRows(store.ingredients, store.menus, store.transactions, store.stockMovements), [store])
  const critical = rows.filter((row) => row.stock < row.minStock)
  const suggestions = rows.filter((row) => row.purchaseQty > 0)

  return (
    <>
      <section className="owner-stats">
        <article className="owner-stat">
          <span className="owner-stat-icon"><Boxes size={18} /></span>
          <div><span>Bahan dipantau</span><strong>{rows.length}</strong><small>Rata-rata pemakaian 7 hari</small></div>
        </article>
        <article className="owner-stat">
          <span className="owner-stat-icon"><AlertTriangle size={18} /></span>
          <div><span>Di bawah minimum</span><strong>{critical.length}</strong><small>{critical.length === 0 ? 'Semua stok aman' : 'Perlu dibeli segera'}</small></div>
        </article>
        <article className="owner-stat">
          <span className="owner-stat-icon"><ShoppingCart size={18} /></span>
          <div><span>Saran pembelian</span><strong>{suggestions.length}</strong><small>Bahan dengan kebutuhan mingguan</small></div>
        </article>
      </section>

      <section className="owner-panel">
        <div className="owner-panel-head">
          <div><h2>Kebutuhan harian & mingguan</h2><p className="owner-muted">Dihitung dari pemakaian resep pada transaksi selesai. Kebutuhan mingguan = harian × 7.</p></div>
          <span className="owner-count"><TrendingUp size={13} /> 7 hari</span>
        </div>
        <div className="owner-table-wrap">
          <table className="owner-data">
            <thead><tr><th>Bahan</th><th>Harian</th><th>Mingguan</th><th>Stok</th><th>Saran beli</th><th>Estimasi biaya</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const ingredient = store.ingredients.find((item) => item.id === row.ingredientId)
                return <tr key={row.ingredientId}>
                  <td><strong>{row.name}</strong><span className="owner-cell-sub">{row.unit}</span></td>
                  <td>{row.dailyNeed.toFixed(1)}</td>
                  <td>{row.weeklyNeed.toFixed(1)}</td>
                  <td><span className={row.stock < row.minStock ? 'owner-pill danger' : 'owner-pill ok'}>{Math.round(row.stock)}</span></td>
                  <td>{row.purchaseQty > 0 ? `${row.purchaseQty} × ${ingredient?.purchaseUnit ?? 'pack'}` : '—'}</td>
                  <td>{row.purchaseQty > 0 ? money(row.purchaseQty * (ingredient?.purchasePrice ?? 0)) : '—'}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
        <p className="owner-muted">Forecast bersifat teoretis. Penyesuaian stok dan waste tetap perlu dicatat di tab Bahan & stok.</p>
      </section>
    </>
  )
}
