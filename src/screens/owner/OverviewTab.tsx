import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, BarChart3, Boxes, Clock3, CreditCard,
  PackageSearch, Plus, Printer, ReceiptText, TrendingUp, UtensilsCrossed, Wallet,
} from 'lucide-react'

import { buildOverviewSummary, dateInputValue, resolvePeriod, type HourPoint, type PaymentSlice, type SummaryPeriod } from '../../domain/analytics'
import { inventoryRows, inventoryValue, topSellingMenus, usageFromTransactions } from '../../domain/inventory'
import type { OwnerTabProps } from './types'
import { money } from './ui'

const periodOptions: { id: SummaryPeriod; label: string }[] = [
  { id: 'today', label: 'Hari ini' },
  { id: '7d', label: '7 hari' },
  { id: '30d', label: '30 hari' },
  { id: 'month', label: 'Bulan ini' },
  { id: 'custom', label: 'Kustom' },
]

const percent = (value: number) => `${value.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`

type OverviewStat = { label: string; value: string; hint: string; icon: ReactNode; delta?: number | null }

function DeltaNote({ value }: { value: number | null }) {
  if (value === null) return <small className="owner-stat-delta flat">Baru di periode ini</small>
  const positive = value >= 0
  return (
    <small className={positive ? 'owner-stat-delta up' : 'owner-stat-delta down'}>
      {positive ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {percent(Math.abs(value))} vs periode sebelumnya
    </small>
  )
}

function TrendChart({ points }: { points: ReturnType<typeof buildOverviewSummary>['trend'] }) {
  const width = 720
  const height = 224
  const left = 46
  const right = 10
  const top = 18
  const bottom = 30
  const plotHeight = height - top - bottom
  const maxRevenue = Math.max(1, ...points.map((point) => point.revenue))
  const step = (width - left - right) / Math.max(1, points.length - 1)
  const baseY = top + plotHeight
  const coords = points.map((point, index) => ({
    point,
    x: left + index * step,
    y: top + plotHeight - (point.revenue / maxRevenue) * plotHeight,
  }))
  const linePath = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`).join(' ')
  const areaPath = coords.length > 0
    ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${baseY} L ${coords[0].x.toFixed(1)} ${baseY} Z`
    : ''
  const labelEvery = Math.max(1, Math.ceil(points.length / 7))
  const total = points.reduce((sum, point) => sum + point.revenue, 0)

  return (
    <svg
      className="owner-trend"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Grafik tren penjualan, total ${money(total)}`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((factor) => {
        const y = top + plotHeight * factor
        return <line key={factor} x1={left} x2={width - right} y1={y} y2={y} className="owner-trend-grid" />
      })}
      <text x={left - 6} y={top + 4} textAnchor="end" className="owner-trend-axis">{money(maxRevenue)}</text>
      <text x={left - 6} y={baseY + 3} textAnchor="end" className="owner-trend-axis">Rp0</text>
      {areaPath && <path d={areaPath} className="owner-trend-area" />}
      {linePath && <path d={linePath} className="owner-trend-line" />}
      {coords.map((coord) => (
        <circle key={coord.point.key} cx={coord.x} cy={coord.y} r="3" className="owner-trend-dot">
          <title>{`${coord.point.detail}: ${money(coord.point.revenue)} • ${coord.point.transactions} transaksi`}</title>
        </circle>
      ))}
      {coords.map((coord, index) => (
        (index % labelEvery === 0 || index === coords.length - 1) && (
          <text key={`label-${coord.point.key}`} x={coord.x} y={height - 7} textAnchor={index === 0 ? 'start' : index === coords.length - 1 ? 'end' : 'middle'} className="owner-trend-label">{coord.point.label}</text>
        )
      ))}
    </svg>
  )
}

function PaymentDonut({ slices, total }: { slices: PaymentSlice[]; total: number }) {
  const value = (key: PaymentSlice['key']) => slices.find((slice) => slice.key === key)?.value ?? 0
  const cash = value('cash')
  const qris = value('qris')
  const cashEnd = total > 0 ? (cash / total) * 100 : 0
  const qrisEnd = total > 0 ? ((cash + qris) / total) * 100 : 0
  const background = total > 0
    ? `conic-gradient(var(--pay-cash) 0 ${cashEnd}%, var(--pay-qris) ${cashEnd}% ${qrisEnd}%, var(--pay-unpaid) ${qrisEnd}% 100%)`
    : undefined

  return (
    <div className="owner-payment-body">
      <div className="owner-donut" style={{ background }} role="img" aria-label={`Komposisi pembayaran dari total ${money(total)}`}>
        <div className="owner-donut-center">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </div>
      </div>
      <div className="owner-payment-legend">
        {slices.map((slice) => (
          <div className="owner-payment-legend-row" key={slice.key}>
            <span className={`owner-pay-dot ${slice.key}`} />
            <div><strong>{slice.label}</strong><small>{money(slice.value)} • {percent(slice.share)}</small></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HourChart({ hours, peakHour }: { hours: HourPoint[]; peakHour: HourPoint | null }) {
  const maxRevenue = Math.max(1, ...hours.map((hour) => hour.revenue))
  return (
    <>
      <p className="owner-muted">
        {peakHour ? `Puncak ${peakHour.label} • ${peakHour.transactions} transaksi • ${money(peakHour.revenue)}` : 'Belum ada transaksi pada periode ini.'}
      </p>
      <div className="owner-hour-chart" role="img" aria-label="Grafik pola jam pesanan">
        {hours.map((hour) => (
          <div className="owner-hour-col" key={hour.hour}>
            <i
              className={hour.revenue > 0 ? 'owner-hour-bar has-value' : 'owner-hour-bar'}
              style={{ height: `${hour.revenue > 0 ? Math.max(5, (hour.revenue / maxRevenue) * 100) : 2}%` }}
              title={`${hour.label} • ${money(hour.revenue)} • ${hour.transactions} transaksi`}
            />
            <span>{hour.hour % 6 === 0 ? String(hour.hour).padStart(2, '0') : ''}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function BarList({ rows }: { rows: { key: string; label: string; value: number; meta: string }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  if (rows.length === 0) return <p className="owner-muted">Belum ada data pada periode ini.</p>
  return (
    <div className="owner-bar-list">
      {rows.map((row) => (
        <div className="owner-bar-row" key={row.key}>
          <div className="owner-bar-copy"><strong>{row.label}</strong><small>{row.meta}</small></div>
          <div className="owner-bar-track"><i style={{ width: `${(row.value / max) * 100}%` }} /></div>
          <b>{money(row.value)}</b>
        </div>
      ))}
    </div>
  )
}

export function OverviewTab({ store, goTab }: OwnerTabProps) {
  const [period, setPeriod] = useState<SummaryPeriod>('today')
  const [customStart, setCustomStart] = useState(() => dateInputValue(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)))
  const [customEnd, setCustomEnd] = useState(() => dateInputValue(new Date()))

  const summary = useMemo(
    () => buildOverviewSummary(store, resolvePeriod(period, new Date(), customStart, customEnd)),
    [store, period, customStart, customEnd],
  )
  const { metrics } = summary
  const selectedPeriod = periodOptions.find((option) => option.id === period)?.label ?? 'Hari ini'
  const rangeTransactions = useMemo(
    () => store.transactions.filter((transaction) => transaction.status === 'completed' && new Date(transaction.createdAt).getTime() >= summary.range.start.getTime() && new Date(transaction.createdAt).getTime() <= summary.range.end.getTime()),
    [store.transactions, summary.range.start, summary.range.end],
  )
  const topToday = topSellingMenus(rangeTransactions, 5)
  const rows = useMemo(() => inventoryRows(store.ingredients, store.menus, store.transactions, store.stockMovements), [store])
  const lowStock = rows.filter((row) => row.stock < row.minStock)
  const usage = useMemo(() => usageFromTransactions(store.transactions, store.menus), [store.transactions, store.menus])
  const stockValue = inventoryValue(store.ingredients, store.stockMovements, usage)
  const activeMenus = store.menus.filter((menu) => menu.active).length

  const stats: OverviewStat[] = [
    { label: 'Penjualan', value: money(metrics.revenue), hint: `${metrics.transactions} transaksi • ${metrics.items} item`, icon: <Banknote size={18} />, delta: metrics.revenueDelta },
    { label: 'Laba kotor', value: money(metrics.grossProfit), hint: `Margin ${percent(metrics.grossMargin)} • HPP ${money(metrics.cogs)}`, icon: <TrendingUp size={18} /> },
    { label: 'Laba bersih', value: money(metrics.netProfit), hint: `Beban ${money(metrics.expenses)} • selisih stok ${money(metrics.inventoryAdjustment)}`, icon: <Wallet size={18} /> },
    { label: 'Transaksi', value: String(metrics.transactions), hint: `Rata-rata ${money(metrics.averageTicket)}`, icon: <ReceiptText size={18} />, delta: metrics.transactionDelta },
    { label: 'Rata-rata transaksi', value: money(metrics.averageTicket), hint: `${money(metrics.averageDailyRevenue)} per hari`, icon: <BarChart3 size={18} /> },
    { label: 'Item terjual', value: String(metrics.items), hint: `${(metrics.items / Math.max(1, metrics.transactions)).toLocaleString('id-ID', { maximumFractionDigits: 1 })} item per transaksi`, icon: <UtensilsCrossed size={18} /> },
    { label: 'Kas diterima', value: money(metrics.received), hint: `Cash ${money(metrics.cashReceived)} • QRIS ${money(metrics.qrisReceived)}`, icon: <CreditCard size={18} /> },
    { label: 'Belum terbayar', value: money(metrics.unpaid), hint: `${metrics.expenseCount} biaya tercatat • nilai stok ${money(stockValue)}`, icon: <PackageSearch size={18} /> },
  ]

  return (
    <>
      <section className="owner-period-bar">
        <div className="owner-period-copy">
          <span className="eyebrow">PERIODE RINGKASAN</span>
          <strong>{selectedPeriod}</strong>
          <small>{summary.range.label} • pembanding {summary.previous.label}</small>
        </div>
        <div className="owner-period-tabs" role="group" aria-label="Filter periode ringkasan">
          {periodOptions.map((option) => (
            <button
              key={option.id}
              className={period === option.id ? 'owner-period-tab active' : 'owner-period-tab'}
              aria-pressed={period === option.id}
              aria-label={`Periode ${option.label}`}
              onClick={() => setPeriod(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="owner-period-custom">
            <label>Dari <input type="date" aria-label="Tanggal mulai ringkasan" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} /></label>
            <label>Sampai <input type="date" aria-label="Tanggal akhir ringkasan" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} /></label>
          </div>
        )}
      </section>

      <section className="owner-stats">
        {stats.map((stat) => (
          <article className="owner-stat" key={stat.label}>
            <span className="owner-stat-icon">{stat.icon}</span>
            <div>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>{stat.hint}</small>
              {stat.delta !== undefined && <DeltaNote value={stat.delta} />}
            </div>
          </article>
        ))}
      </section>

      <section className="owner-insight-grid">
        <article className="owner-panel owner-trend-panel">
          <div className="owner-panel-head">
            <div><h2>Tren penjualan</h2><p className="owner-muted">{summary.range.label} • total {money(metrics.revenue)}</p></div>
            <span className={metrics.revenueDelta !== null && metrics.revenueDelta < 0 ? 'owner-pill danger' : 'owner-pill ok'}>
              {metrics.revenueDelta === null ? 'PERIODE BARU' : `${metrics.revenueDelta >= 0 ? '+' : ''}${percent(metrics.revenueDelta)}`}
            </span>
          </div>
          <div className="owner-chart-kpis">
            <div><span>Penjualan</span><b>{money(metrics.revenue)}</b></div>
            <div><span>Rata-rata / hari</span><b>{money(metrics.averageDailyRevenue)}</b></div>
            <div><span>Transaksi</span><b>{metrics.transactions}</b></div>
          </div>
          <TrendChart points={summary.trend} />
        </article>

        <article className="owner-panel owner-payment-panel">
          <div className="owner-panel-head">
            <div><h2>Komposisi pembayaran</h2><p className="owner-muted">Penerimaan aktual pada periode ini.</p></div>
          </div>
          <PaymentDonut slices={summary.payments} total={metrics.revenue} />
        </article>
      </section>

      <section className="owner-quick">
        <button onClick={() => goTab('menu')}><span className="owner-quick-icon"><Plus size={17} /></span><div><strong>Menu baru</strong><small>Tambah menu, foto, dan resep</small></div><ArrowRight size={16} /></button>
        <button onClick={() => goTab('stok')}><span className="owner-quick-icon"><Boxes size={17} /></span><div><strong>Catat pembelian</strong><small>Beberapa bahan sekaligus</small></div><ArrowRight size={16} /></button>
        <button onClick={() => goTab('pengaturan')}><span className="owner-quick-icon"><Printer size={17} /></span><div><strong>Atur printer</strong><small>Kertas 58/80 mm & cetak otomatis</small></div><ArrowRight size={16} /></button>
      </section>

      <div className="owner-two-col">
        <section className="owner-panel">
          <div className="owner-panel-head">
            <div><h2>Menu terlaris</h2><p className="owner-muted">{activeMenus} menu aktif dari {store.menus.length} menu.</p></div>
            <button className="owner-link" onClick={() => goTab('laporan')}>Lihat laporan <ArrowRight size={14} /></button>
          </div>
          {topToday.length === 0 ? <p className="owner-muted">Belum ada penjualan pada periode ini.</p> : (
            <div className="owner-rank-list">
              {topToday.map((item, index) => (
                <div className="owner-rank-row" key={item.id}>
                  <span className="owner-rank">{index + 1}</span>
                  <div><strong>{item.name}</strong><small>{item.qty} porsi terjual</small></div>
                  <b>{money(item.revenue)}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="owner-panel">
          <div className="owner-panel-head">
            <div><h2>Kanal pesanan</h2><p className="owner-muted">Kontribusi penjualan per tipe pesanan.</p></div>
          </div>
          <BarList rows={summary.channels.map((channel) => ({ key: channel.key, label: channel.label, value: channel.revenue, meta: `${percent(channel.share)} • ${channel.transactions} transaksi` }))} />
        </section>
      </div>

      <div className="owner-two-col">
        <section className="owner-panel">
          <div className="owner-panel-head">
            <div><h2>Kategori teratas</h2><p className="owner-muted">Kategori dengan kontribusi penjualan terbesar.</p></div>
          </div>
          <BarList rows={summary.categories.slice(0, 6).map((category) => ({ key: category.key, label: category.label, value: category.revenue, meta: `${percent(category.share)} • ${category.items} item` }))} />
        </section>

        <section className="owner-panel">
          <div className="owner-panel-head">
            <div><h2>Pola jam pesanan</h2><p className="owner-muted">Distribusi transaksi sepanjang hari.</p></div>
            <span className="owner-pill"><Clock3 size={11} /> 24 jam</span>
          </div>
          <HourChart hours={summary.hours} peakHour={summary.peakHour} />
        </section>
      </div>

      <section className="owner-panel">
        <div className="owner-panel-head">
          <div><h2>Bahan perlu dibeli</h2><p className="owner-muted">Stok di bawah batas minimum. Nilai persediaan saat ini {money(stockValue)}.</p></div>
          <button className="owner-link" onClick={() => goTab('stok')}>Buka stok <ArrowRight size={14} /></button>
        </div>
        {lowStock.length === 0 ? <p className="owner-muted">Semua stok aman.</p> : (
          <div className="owner-rank-list">
            {lowStock.slice(0, 6).map((row) => (
              <div className="owner-rank-row" key={row.ingredientId}>
                <span className="owner-rank warn"><UtensilsCrossed size={13} /></span>
                <div><strong>{row.name}</strong><small>Stok {Math.round(row.stock)} {row.unit} • min {Math.round(row.minStock)}</small></div>
                <b>{Math.max(0, Math.ceil(row.minStock - row.stock))} {row.unit}</b>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
