import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Wifi, WifiOff } from 'lucide-react'

import type { PosStore } from '../../domain/pos'
import { loadCloudConfig, loadCloudSession, type CloudBackupConfig, type CloudSession } from '../../lib/cloud-backup'
import { savePosStore } from '../../lib/persistence'
import {
  getSyncStatus,
  hydrateSyncStatus,
  readConflicts,
  readOutbox,
  subscribeSyncStatus,
  syncNow,
  type SyncConflict,
  type SyncStatus,
} from '../../lib/sync-client'

const stateLabel: Record<SyncStatus['state'], string> = {
  disabled: 'Nonaktif',
  'pending-setup': 'Belum tersambung',
  idle: 'Siap',
  pulling: 'Menarik perubahan…',
  pushing: 'Mengirim antrean…',
  ok: 'Tersinkron',
  error: 'Gagal terakhir',
}

const realtimeLabel: Record<SyncStatus['realtime'], string> = {
  connected: 'Realtime aktif',
  polling: 'Polling (fallback)',
  off: 'Mati',
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID')
}

function reasonLabel(value: string): string {
  if (value === 'sale') return 'penjualan'
  if (value === 'category') return 'kategori'
  if (value === 'menu') return 'menu'
  if (value === 'ingredient') return 'bahan'
  if (value === 'menu_recipe') return 'resep'
  if (value === 'outlet_settings') return 'pengaturan'
  return value
}

type Props = {
  store: PosStore
  setStore: (store: PosStore) => void
  notify: (message: string) => void
}

export function SyncPanel({ store, setStore, notify }: Props) {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus())
  const [config, setConfig] = useState<CloudBackupConfig | null>(null)
  const [session, setSession] = useState<CloudSession | null>(null)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => subscribeSyncStatus(setStatus), [])

  useEffect(() => {
    let active = true
    void (async () => {
      const storedConfig = await loadCloudConfig()
      const storedSession = await loadCloudSession()
      const nextStatus = await hydrateSyncStatus()
      const storedConflicts = await readConflicts()
      if (!active) return
      setConfig(storedConfig)
      setSession(storedSession)
      setStatus(nextStatus)
      setConflicts(storedConflicts)
    })()
    return () => { active = false }
  }, [])

  const syncNowManually = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const summary = await syncNow({
        store,
        onStore: async (next) => {
          await savePosStore(next)
          setStore(next)
        },
      })
      setConflicts(await readConflicts())
      const pending = (await readOutbox()).length
      if (summary.skipped === 'disabled') {
        notify('Aktifkan backup cloud terlebih dahulu untuk memakai sinkronisasi')
      } else if (summary.skipped === 'no-session') {
        notify('Masuk dengan akun pemilik Supabase untuk sinkronisasi')
      } else if (summary.ok) {
        notify(`Sinkron selesai • ${summary.applied} perubahan diterapkan • ${pending} tertunda`)
      } else {
        const message = summary.error ?? 'Sinkronisasi gagal'
        setError(message)
        notify(message)
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      notify(message)
    } finally {
      setBusy(false)
    }
  }, [notify, setStore, store])

  const configured = Boolean(config?.enabled)
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  return (
    <section className="owner-panel">
      <div className="owner-panel-head">
        <div>
          <h2>Sinkronisasi katalog</h2>
          <p className="owner-muted">
            Menarik perubahan katalog (kategori, menu, bahan, resep, pengaturan) dari Supabase dan mengirim antrean penjualan lewat RPC
            atomik. Kasir tetap bekerja dari IndexedDB; sinkronisasi tidak pernah menahan transaksi.
          </p>
        </div>
        <span className="owner-stat-icon">{offline ? <WifiOff size={17} /> : <Wifi size={17} />}</span>
      </div>

      <div className="owner-metric-list">
        <div><span>Status</span><b>{stateLabel[status.state]}</b></div>
        <div><span>Koneksi</span><b>{offline ? 'Offline — antrean disimpan' : realtimeLabel[status.realtime]}</b></div>
        <div><span>Seq terakhir</span><b>{status.lastSeq ?? 0}</b></div>
        <div><span>Pull terakhir</span><b>{formatDate(status.lastPullAt)}</b></div>
        <div><span>Perubahan tertunda</span><b>{status.pending}</b></div>
        <div><span>Konflik tercatat</span><b>{status.conflicts}</b></div>
      </div>

      {!configured && (
        <div className="owner-setting-note">
          <strong>Belum aktif</strong>
          <span>Aktifkan <em>Backup cloud</em> di bawah. Kredensial dan sesi yang sama dipakai untuk sinkronisasi; tidak ada login terpisah.</span>
        </div>
      )}
      {configured && !session && (
        <div className="owner-setting-note danger">
          <strong>Sesi tidak aktif</strong>
          <span>Masuk ulang lewat panel Backup cloud; antrean penjualan tetap tersimpan lokal sampai sesi tersedia.</span>
        </div>
      )}
      {(status.lastError || error) && (
        <div className="owner-setting-note danger">
          <strong>Diagnostik</strong>
          <span>{error || status.lastError}</span>
        </div>
      )}

      <div className="owner-backup-actions">
        <button className="owner-primary" onClick={() => void syncNowManually()} disabled={busy}>
          <RefreshCw size={15} /> {busy ? 'Menyinkronkan…' : 'Sinkronkan sekarang'}
        </button>
      </div>

      {conflicts.length > 0 && (
        <div className="owner-audit-list">
          {conflicts.slice(0, 5).map((conflict) => (
            <div className="owner-audit-row" key={conflict.id}>
              <span className="owner-audit-action">{reasonLabel(conflict.entity)}</span>
              <span className="owner-audit-detail">
                <AlertTriangle size={12} /> {conflict.entityId} • {conflict.reason} (remote v{conflict.remoteVersion} vs lokal v{conflict.localVersion})
              </span>
              <time>{formatDate(conflict.at)}</time>
            </div>
          ))}
        </div>
      )}

      <div className="owner-setting-note">
        <strong>Strategi konflik</strong>
        <span>
          Master data memakai last-write-wins berbasis <code>row_version</code> dan urutan <code>seq</code>; versi remote yang lebih tua dilewati.
          Baris yang punya perubahan lokal tertunda tidak ditimpa dan dicatat sebagai konflik. Ledger (transaksi, kas, shift, stok) tidak pernah
          ditimpa pull; penjualan dikirim lewat <code>apply_sale</code> yang idempoten. Hapus/soft delete ikut diterapkan sebagai tombstone.
        </span>
      </div>
    </section>
  )
}
