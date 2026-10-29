import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import {
  ArrowLeft, BarChart3, Boxes, ChefHat, DatabaseBackup, LayoutDashboard, Moon, Settings,
  Sun, Tags, TrendingUp, UtensilsCrossed,
} from 'lucide-react'

import { expectedCashForShift, type PosStore } from '../domain/pos'
import { money } from './owner/ui'
import type { OwnerTab } from './owner/types'
import { OverviewTab } from './owner/OverviewTab'
import { MenuTab } from './owner/MenuTab'
import { CategoryTab } from './owner/CategoryTab'
import { StockTab } from './owner/StockTab'
import { ForecastTab } from './owner/ForecastTab'
import { ReportsTab } from './owner/ReportsTab'
import { SettingsTab } from './owner/SettingsTab'
import { BackupTab } from './owner/BackupTab'

type Props = {
  store: PosStore
  setStore: Dispatch<SetStateAction<PosStore>>
  onBack: () => void
  darkMode: boolean
  onToggleTheme: () => void
  initialTab?: OwnerTab
}

const tabs = [
  { id: 'ringkasan' as const, label: 'Ringkasan', icon: LayoutDashboard, title: 'Ringkasan outlet', subtitle: 'Penjualan, kas, dan stok dalam satu tampilan.' },
  { id: 'menu' as const, label: 'Menu & HPP', icon: UtensilsCrossed, title: 'Menu & harga pokok', subtitle: 'Kelola menu, foto, harga, dan resep bahan.' },
  { id: 'kategori' as const, label: 'Kategori', icon: Tags, title: 'Kategori menu & bahan', subtitle: 'Kelola kelompok menu kasir dan kategori bahan baku.' },
  { id: 'stok' as const, label: 'Bahan & stok', icon: Boxes, title: 'Bahan & stok', subtitle: 'Catat pembelian massal, stok, dan penyesuaian.' },
  { id: 'forecast' as const, label: 'Forecast', icon: TrendingUp, title: 'Forecast bahan', subtitle: 'Perkiraan kebutuhan harian dan mingguan dari penjualan.' },
  { id: 'laporan' as const, label: 'Laporan', icon: BarChart3, title: 'Laporan keuangan', subtitle: 'Laba rugi, neraca, dan buku besar double-entry.' },
  { id: 'pengaturan' as const, label: 'Pengaturan', icon: Settings, title: 'Pengaturan aplikasi', subtitle: 'Identitas outlet, struk, printer, dan tampilan.' },
  { id: 'backup' as const, label: 'Backup', icon: DatabaseBackup, title: 'Backup & data', subtitle: 'Unduh data, pulihkan perangkat, dan periksa audit log.' },
]

export function OwnerScreen({ store, setStore, onBack, darkMode, onToggleTheme, initialTab = 'ringkasan' }: Props) {
  const [tab, setTab] = useState<OwnerTab>(initialTab)
  const [message, setMessage] = useState('')
  const activeShift = store.shifts.find((shift) => shift.status === 'open')
  const meta = tabs.find((item) => item.id === tab) ?? tabs[0]

  useEffect(() => { setTab(initialTab) }, [initialTab])

  const notify = (text: string) => {
    setMessage(text)
    window.setTimeout(() => setMessage(''), 3200)
  }

  const renderTab = () => {
    const props = { store, setStore, notify, goTab: setTab }
    switch (tab) {
      case 'menu': return <MenuTab {...props} />
      case 'kategori': return <CategoryTab {...props} />
      case 'stok': return <StockTab {...props} />
      case 'forecast': return <ForecastTab store={store} />
      case 'laporan': return <ReportsTab store={store} setStore={setStore} notify={notify} />
      case 'pengaturan': return <SettingsTab {...props} />
      case 'backup': return <BackupTab {...props} />
      default: return <OverviewTab {...props} />
    }
  }

  return (
    <div className={darkMode ? 'pos-shell dark-theme' : 'pos-shell'}>
      <header className="pos-topbar owner-topbar">
        <div className="brand">
          <div className="brand-mark"><ChefHat size={20} /></div>
          <div><strong>Sabana POS</strong><span>Mode pemilik • {store.settings.outletName}</span>{store.settings.outletPhone && <span className="brand-phone">{store.settings.outletPhone}</span>}</div>
        </div>
        <div className="top-actions">
          <button className="owner-back" onClick={onBack}><ArrowLeft size={15} /> Kasir</button>
          <button className="top-status theme-status" onClick={onToggleTheme} aria-label="Ganti tema">{darkMode ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </header>

      <div className="owner-layout">
        <nav className="owner-nav" aria-label="Navigasi mode pemilik">
          <span className="owner-nav-label">KELOLA OUTLET</span>
          {tabs.map((item) => {
            const Icon = item.icon
            return <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><Icon size={16} />{item.label}</button>
          })}
          <div className="owner-nav-foot">
            {activeShift ? <><span className="live-dot" /> Shift aktif • {money(expectedCashForShift(store, activeShift))}</> : <>Shift belum dibuka</>}
          </div>
        </nav>

        <main className="owner-main">
          <div className="owner-page-head">
            <div>
              <span className="eyebrow">MODE PEMILIK</span>
              <h1>{meta.title}</h1>
              <p>{meta.subtitle}</p>
            </div>
            <span className={activeShift ? 'owner-shift-chip' : 'owner-shift-chip muted'}>
              {activeShift ? <><span className="live-dot" /> Shift aktif</> : 'Kasir terkunci'}
            </span>
          </div>

          {message && <div className="owner-toast" role="status">{message}</div>}
          {renderTab()}
        </main>
      </div>
    </div>
  )
}
