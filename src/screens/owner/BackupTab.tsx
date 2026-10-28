import { useEffect, useMemo, useRef, useState } from 'react'
import { DatabaseBackup, Download, History, ShieldAlert, Upload } from 'lucide-react'

import { buildJournals, chartOfAccounts } from '../../domain/accounting'
import { cogsForTransactions, inventoryValue, usageFromTransactions } from '../../domain/inventory'
import type { PosStore } from '../../domain/pos'
import {
  applyRestoredStore,
  createAndStoreBackup,
  downloadBackup,
  inspectBackup,
  readLatestBackup,
  type BackupMeta,
  type BackupRecord,
} from '../../lib/backup'
import { downloadCsv } from '../../lib/csv'
import { savePosStore } from '../../lib/persistence'
import { describeStorageError, getStorageBackend } from '../../lib/storage'
import { CloudBackupPanel } from './CloudBackupPanel'
import { SyncPanel } from './SyncPanel'
import type { OwnerTabProps } from './types'
import { money } from './ui'

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function formatBackupDate(value: string) {
  if (!value) return 'tanggal tidak tercatat'
  return new Date(value).toLocaleString('id-ID')
}

const reasonLabel: Record<string, string> = {
  daily: 'otomatis harian',
  'before-shift-close': 'sebelum tutup shift',
  manual: 'manual',
  legacy: 'backup lama',
}

export function BackupTab({ store, setStore, notify }: OwnerTabProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [latest, setLatest] = useState<BackupRecord | null>(null)
  const [backupError, setBackupError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<{ store: PosStore; meta: BackupMeta; fileName: string } | null>(null)

  const journals = useMemo(() => buildJournals({
    transactions: store.transactions,
    cashMovements: store.cashMovements,
    stockMovements: store.stockMovements,
    expenses: store.expenses,
    hppOf: (transaction) => cogsForTransactions([transaction], store.menus, store.ingredients),
  }), [store])

  useEffect(() => {
    let active = true
    void readLatestBackup()
      .then((record) => { if (active) { setLatest(record); setBackupError('') } })
      .catch((error: unknown) => { if (active) setBackupError(describeStorageError(error)) })
    return () => { active = false }
  }, [])

  const makeBackup = async () => {
    setBusy(true)
    setBackupError('')
    try {
      const record = await createAndStoreBackup(store, 'manual')
      setLatest(record)
      downloadBackup(record)
      notify('Backup JSON dibuat dan diunduh')
    } catch (error) {
      const message = describeStorageError(error)
      setBackupError(message)
      notify(`Backup gagal: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  const downloadLatest = async () => {
    setBusy(true)
    try {
      const record = await readLatestBackup()
      if (!record) { notify('Belum ada backup tersimpan'); return }
      downloadBackup(record)
      notify('Backup terakhir diunduh')
    } catch (error) {
      const message = describeStorageError(error)
      setBackupError(message)
      notify(`Backup tidak bisa dibaca: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  const chooseBackup = async (file: File) => {
    const inspected = inspectBackup(await file.text())
    if (!inspected.ok) {
      notify(`Restore ditolak: ${inspected.error}`)
      return
    }
    setPendingRestore({ store: inspected.store, meta: inspected.meta, fileName: file.name })
  }

  const confirmRestore = async () => {
    if (!pendingRestore) return
    setBusy(true)
    try {
      const next: PosStore = applyRestoredStore(pendingRestore.store, store, pendingRestore.fileName)
      await savePosStore(next)
      setStore(next)
      setPendingRestore(null)
      notify('Backup dipulihkan • memuat ulang aplikasi')
      window.setTimeout(() => window.location.reload(), 80)
    } catch (error) {
      notify(`Restore gagal: ${describeStorageError(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const exportSalesCsv = () => {
    const rows: (string | number)[][] = [['nomor', 'tanggal', 'tipe_pesanan', 'pembayaran', 'total', 'dibayar', 'kembalian', 'status']]
    for (const transaction of store.transactions) rows.push([transaction.number, transaction.createdAt, transaction.orderType, transaction.paymentMethod, transaction.subtotal, transaction.paidAmount, transaction.change, transaction.status])
    downloadCsv(`sabana-penjualan-${todayKey()}.csv`, rows)
    notify('CSV penjualan diunduh • siap dibuka di spreadsheet')
  }

  const exportJournalCsv = () => {
    const rows: (string | number)[][] = [['tanggal', 'keterangan', 'sumber', 'akun', 'debit', 'kredit']]
    for (const entry of journals) for (const line of entry.lines) rows.push([entry.date, entry.description, entry.source, `${line.account} ${chartOfAccounts.find((account) => account.code === line.account)?.name ?? ''}`, line.debit, line.credit])
    downloadCsv(`sabana-jurnal-${todayKey()}.csv`, rows)
    notify('CSV jurnal diunduh')
  }

  const backendLabel = getStorageBackend() === 'indexeddb' ? 'IndexedDB' : getStorageBackend() === 'localstorage' ? 'localStorage (fallback)' : 'memori sementara'

  return (
    <>
      <div className="owner-two-col">
        <section className="owner-panel">
          <div className="owner-panel-head">
            <div><h2>Backup & restore</h2><p className="owner-muted">Backup JSON lengkap berisi katalog, transaksi, pengaturan, dan audit log. Backup harian dibuat otomatis saat aplikasi dibuka.</p></div>
            <span className="owner-stat-icon"><DatabaseBackup size={17} /></span>
          </div>
          <div className="owner-backup-actions">
            <button className="owner-primary" onClick={() => void makeBackup()} disabled={busy}><Download size={15} /> Backup sekarang & unduh</button>
            <button className="owner-ghost" onClick={() => void downloadLatest()} disabled={busy}><Download size={15} /> Unduh backup terakhir</button>
            <button className="owner-ghost" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={15} /> Pulihkan backup</button>
            <button className="owner-ghost" onClick={exportSalesCsv}><Download size={15} /> CSV penjualan</button>
            <button className="owner-ghost" onClick={exportJournalCsv}><Download size={15} /> CSV jurnal</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseBackup(file); event.target.value = '' }} />
          </div>
          <div className="owner-setting-note">
            <strong>Backup terakhir</strong>
            <span>{latest ? `${formatBackupDate(latest.createdAt)} • ${reasonLabel[latest.reason] ?? latest.reason} • ${latest.summary.transactions} transaksi • v${latest.schemaVersion}` : 'Belum ada backup tersimpan di perangkat.'}</span>
          </div>
          {backupError && <div className="owner-setting-note danger"><strong>Penyimpanan</strong><span>{backupError}</span></div>}
          <div className="owner-setting-note">
            <strong>Data lokal</strong>
            <span>Penyimpanan aktif: {backendLabel}. Backup disimpan di perangkat yang sama; unduh file JSON untuk salinan di luar perangkat.</span>
          </div>
        </section>

        <section className="owner-panel">
          <h2>Isi data</h2>
          <div className="owner-metric-list">
            <div><span>Transaksi</span><b>{store.transactions.length}</b></div>
            <div><span>Pesanan ditahan</span><b>{store.heldOrders.length}</b></div>
            <div><span>Pre-order</span><b>{store.preOrders.length}</b></div>
            <div><span>Pergerakan stok</span><b>{store.stockMovements.length}</b></div>
            <div><span>Beban operasional</span><b>{store.expenses.length}</b></div>
            <div><span>Nilai persediaan</span><b>{money(inventoryValue(store.ingredients, store.stockMovements, usageFromTransactions(store.transactions, store.menus)))}</b></div>
          </div>
        </section>
      </div>

      <SyncPanel store={store} setStore={setStore} notify={notify} />

      <CloudBackupPanel
        notify={notify}
        onRestoreRequest={(nextStore, meta, label) => setPendingRestore({ store: nextStore, meta, fileName: label })}
      />

      <section className="owner-panel">
        <div className="owner-panel-head">
          <div><h2>Audit log</h2><p className="owner-muted">Transaksi tidak pernah dihapus; perubahan menu, stok, kas, dan pengaturan tercatat di sini.</p></div>
          <span className="owner-count"><History size={13} /> {store.auditLog.length} entri</span>
        </div>
        {store.auditLog.length === 0 ? <p className="owner-muted">Belum ada aktivitas tercatat.</p> : (
          <div className="owner-audit-list">
            {[...store.auditLog].reverse().slice(0, 40).map((entry) => <div className="owner-audit-row" key={entry.id}><span className="owner-audit-action">{entry.action.replace(/_/g, ' ')}</span><span className="owner-audit-detail">{entry.detail}</span><time>{new Date(entry.createdAt).toLocaleString('id-ID')}</time></div>)}
          </div>
        )}
      </section>

      {pendingRestore && (
        <div className="modal-backdrop">
          <div className="modal restore-modal" role="dialog" aria-modal="true" aria-label="Konfirmasi restore backup">
            <span className="owner-stat-icon"><ShieldAlert size={18} /></span>
            <span className="eyebrow">KONFIRMASI RESTORE</span>
            <h2>Tinjau isi backup</h2>
            <p className="modal-muted">Sumber <strong>{pendingRestore.fileName}</strong> akan menimpa seluruh data saat ini. Tindakan ini tidak bisa dibatalkan tanpa backup lain.</p>
            <div className="owner-metric-list">
              <div><span>Dibuat</span><b>{formatBackupDate(pendingRestore.meta.createdAt)}</b></div>
              <div><span>Skema</span><b>v{pendingRestore.meta.schemaVersion}</b></div>
              <div><span>Outlet</span><b>{pendingRestore.meta.summary.outletName}</b></div>
              <div><span>Transaksi</span><b>{pendingRestore.meta.summary.transactions}</b></div>
              <div><span>Menu / bahan</span><b>{pendingRestore.meta.summary.menus} / {pendingRestore.meta.summary.ingredients}</b></div>
              <div><span>Kategori</span><b>{pendingRestore.meta.summary.categories}</b></div>
            </div>
            <p className="restore-warning">Pastikan file berasal dari perangkat ini. Data saat ini akan diganti dan aplikasi dimuat ulang. PIN pemilik yang aktif saat ini dipertahankan.</p>
            <div className="restore-actions">
              <button className="owner-ghost" onClick={() => setPendingRestore(null)} disabled={busy}>Batal</button>
              <button className="owner-primary" onClick={() => void confirmRestore()} disabled={busy}>{busy ? 'Memulihkan…' : 'Timpa data & muat ulang'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
