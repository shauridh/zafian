import { useCallback, useEffect, useState } from 'react'
import { CloudUpload, CloudOff, DownloadCloud, KeyRound, Link2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'

import type { PosStore } from '../../domain/pos'
import { inspectBackup, type BackupMeta } from '../../lib/backup'
import {
  CLOUD_BUCKET,
  DEFAULT_PBKDF2_ITERATIONS,
  clearCloudSession,
  deriveCloudKey,
  describeCloudError,
  disableCloudBackup,
  downloadCloudSnapshot,
  getCloudStatus,
  hydrateCloudStatus,
  loadCloudConfig,
  loadCloudSession,
  saveCloudConfig,
  saveCloudSession,
  signInWithPassword,
  subscribeCloudStatus,
  uploadBackupQuietly,
  listCloudSnapshots,
  validateCloudConfigInput,
  type CloudBackupConfig,
  type CloudSession,
  type CloudSnapshotRow,
  type CloudStatus,
} from '../../lib/cloud-backup'
import { createAndStoreBackup } from '../../lib/backup'
import { mergeSupabaseDefaults, supabaseEnvDefaults } from '../../lib/env'
import { Field } from './ui'

const stateLabel: Record<CloudStatus['state'], string> = {
  disabled: 'Nonaktif',
  'pending-setup': 'Belum siap',
  idle: 'Siap',
  uploading: 'Mengunggah…',
  ok: 'Snapshot terunggah',
  error: 'Gagal terakhir',
}

const reasonLabel: Record<string, string> = {
  daily: 'harian',
  'before-shift-close': 'sebelum tutup shift',
  manual: 'manual',
  legacy: 'lama',
}

function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID')
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

const ENV_DEFAULTS = supabaseEnvDefaults()

type Props = {
  store: PosStore
  notify: (message: string) => void
  onRestoreRequest: (store: PosStore, meta: BackupMeta, label: string) => void
}

export function CloudBackupPanel({ store, notify, onRestoreRequest }: Props) {
  const [config, setConfig] = useState<CloudBackupConfig | null>(null)
  const [session, setSession] = useState<CloudSession | null>(null)
  const [status, setStatus] = useState<CloudStatus>(() => getCloudStatus())
  const [rows, setRows] = useState<CloudSnapshotRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => ({
    ...mergeSupabaseDefaults(ENV_DEFAULTS),
    email: '',
    password: '',
    passphrase: '',
    passphraseConfirm: '',
  }))

  useEffect(() => subscribeCloudStatus(setStatus), [])

  const refreshList = useCallback(async (activeConfig: CloudBackupConfig, activeSession: CloudSession) => {
    try {
      const items = await listCloudSnapshots(activeConfig, activeSession)
      setRows(items)
      setError('')
    } catch (caught) {
      setError(describeCloudError(caught))
    }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      const storedConfig = await loadCloudConfig()
      const storedSession = await loadCloudSession()
      const nextStatus = await hydrateCloudStatus({ config: storedConfig })
      if (!active) return
      setConfig(storedConfig)
      setSession(storedSession)
      setStatus(nextStatus)
      if (storedConfig) {
        setForm((current) => ({
          ...current,
          ...mergeSupabaseDefaults(ENV_DEFAULTS, storedConfig),
          email: storedSession?.email ?? '',
        }))
      }
      if (storedConfig?.enabled && storedSession) void refreshList(storedConfig, storedSession)
    })()
    return () => { active = false }
  }, [refreshList])

  const activate = async () => {
    const validation = validateCloudConfigInput(form)
    if (validation) { setError(validation); notify(validation); return }
    setBusy(true)
    setError('')
    try {
      const projectUrl = form.projectUrl.trim().replace(/\/+$/, '')
      const base = { projectUrl, anonKey: form.anonKey.trim() }
      const nextSession = await signInWithPassword(base, form.email, form.password)
      const key = await deriveCloudKey(form.passphrase)
      const nextConfig: CloudBackupConfig = {
        enabled: true,
        projectUrl,
        anonKey: base.anonKey,
        outletId: form.outletId.trim().toLowerCase(),
        bucket: CLOUD_BUCKET,
        key,
        updatedAt: new Date().toISOString(),
      }
      await saveCloudConfig(nextConfig)
      await saveCloudSession(nextSession)
      setConfig(nextConfig)
      setSession(nextSession)
      setForm((current) => ({ ...current, password: '', passphrase: '', passphraseConfirm: '' }))
      setStatus(await hydrateCloudStatus({ config: nextConfig }))
      await refreshList(nextConfig, nextSession)
      notify('Backup cloud aktif • kunci enkripsi dibuat (PBKDF2 + AES-GCM)')
    } catch (caught) {
      const message = describeCloudError(caught)
      setError(message)
      notify(message)
    } finally {
      setBusy(false)
    }
  }

  const uploadNow = async () => {
    if (!config?.enabled) return
    setBusy(true)
    setError('')
    try {
      const record = await createAndStoreBackup(store, 'manual')
      const result = await uploadBackupQuietly(record, { config, session })
      if (result.state === 'ok') {
        notify('Snapshot manual terenkripsi dan terunggah')
        if (session) await refreshList(config, session)
      } else {
        const message = result.lastError ?? 'Snapshot tidak terunggah'
        setError(message)
        notify(message)
      }
    } catch (caught) {
      const message = describeCloudError(caught)
      setError(message)
      notify(message)
    } finally {
      setBusy(false)
    }
  }

  const restoreRow = async (row: CloudSnapshotRow) => {
    if (!config?.enabled) return
    if (!config.key) { setError('Kunci enkripsi tidak ada di perangkat ini. Aktifkan ulang dengan frasa sandi yang sama.'); return }
    setBusy(true)
    setError('')
    try {
      const downloaded = await downloadCloudSnapshot(config, session, row.storagePath, { key: config.key })
      const inspected = inspectBackup(downloaded.text)
      if (!inspected.ok) {
        const message = `Snapshot cloud ditolak: ${inspected.error}`
        setError(message)
        notify(message)
        return
      }
      if (downloaded.checksum !== row.checksum) {
        const message = 'Checksum snapshot cloud tidak sama dengan metadata; unduhan dibatalkan.'
        setError(message)
        notify(message)
        return
      }
      onRestoreRequest(inspected.store, inspected.meta, `snapshot cloud ${formatDate(row.createdAt)}`)
    } catch (caught) {
      const message = describeCloudError(caught)
      setError(message)
      notify(message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await clearCloudSession()
      setSession(null)
      setRows([])
      setStatus(await hydrateCloudStatus({ config }))
      notify('Sesi cloud diputus • backup lokal tetap berjalan')
    } catch (caught) {
      notify(`Gagal memutus sesi: ${describeCloudError(caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const deactivate = async () => {
    if (!window.confirm('Matikan backup cloud? Backup lokal di perangkat tetap berjalan dan snapshot di cloud tidak dihapus.')) return
    setBusy(true)
    try {
      await disableCloudBackup(config)
      setConfig((current) => current ? { ...current, enabled: false } : current)
      setSession(null)
      setRows([])
      setStatus(getCloudStatus())
      notify('Backup cloud dimatikan')
    } catch (caught) {
      notify(`Gagal mematikan backup cloud: ${describeCloudError(caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const enabled = Boolean(config?.enabled)

  return (
    <section className="owner-panel">
      <div className="owner-panel-head">
        <div>
          <h2>Backup cloud (Supabase)</h2>
          <p className="owner-muted">
            Salinan terenkripsi dari backup lokal dikirim ke bucket privat <code>{CLOUD_BUCKET}</code>. Kasir tetap bekerja dari IndexedDB;
            unggahan berjalan di latar belakang dan tidak menahan transaksi.
          </p>
        </div>
        <span className="owner-stat-icon"><CloudUpload size={17} /></span>
      </div>

      <div className="owner-metric-list">
        <div><span>Status</span><b>{stateLabel[status.state]}</b></div>
        <div><span>Transport</span><b>{enabled ? 'Supabase Storage + Auth' : 'Belum aktif'}</b></div>
        <div><span>Snapshot terakhir</span><b>{status.lastSuccessAt ? formatDate(status.lastSuccessAt) : '—'}</b></div>
        <div><span>Enkripsi</span><b>AES-GCM 256 · PBKDF2 {DEFAULT_PBKDF2_ITERATIONS.toLocaleString('id-ID')}</b></div>
      </div>

      {status.lastError && <div className="owner-setting-note danger"><strong>Diagnostik</strong><span>{status.lastError}</span></div>}
      {error && error !== status.lastError && <div className="owner-setting-note danger"><strong>Kesalahan</strong><span>{error}</span></div>}

      {!enabled ? (
        <>
          <div className="owner-setting-note">
            <strong>Yang dibutuhkan</strong>
            <span>URL project Supabase, anon key (bukan service role key), UUID outlet, akun pemilik, dan frasa sandi enkripsi. Aktivasi cukup sekali per perangkat: setelah itu sesi dan kunci turunan disimpan, dan aplikasi menyambung otomatis tanpa membuka pengaturan lagi.</span>
          </div>
          {ENV_DEFAULTS && (
            <div className="owner-setting-note">
              <strong>Terisi dari environment build</strong>
              <span>URL project, anon key, dan UUID outlet dimuat dari environment Vercel. Email, kata sandi, dan frasa sandi hanya diminta sekali saat aktivasi; sesudahnya perangkat menyambung sendiri. Nilai yang tersimpan menimpa nilai environment.</span>
            </div>
          )}
          <div className="printer-grid">
            <div>
              <Field label="URL project" hint="Contoh: https://egyaohgoyridudzoltxb.supabase.co">
                <input value={form.projectUrl} onChange={(event) => setForm({ ...form, projectUrl: event.target.value })} placeholder="https://xxxx.supabase.co" autoComplete="off" />
              </Field>
              <Field label="Anon key" hint="Diambil dari Settings → API. Jangan pakai service role key.">
                <input value={form.anonKey} onChange={(event) => setForm({ ...form, anonKey: event.target.value })} placeholder="eyJhbGciOi..." autoComplete="off" />
              </Field>
              <Field label="UUID outlet" hint="Kolom id pada tabel outlets.">
                <input value={form.outletId} onChange={(event) => setForm({ ...form, outletId: event.target.value })} placeholder="471d3f1c-1ad0-4f88-a35c-7f9f6e968926" autoComplete="off" />
              </Field>
            </div>
            <div>
              <Field label="Email pemilik" hint="Akun Supabase Auth yang punya membership owner di outlet.">
                <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="username" />
              </Field>
              <Field label="Kata sandi" hint="Dipakai sekali untuk login; tidak disimpan di perangkat.">
                <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="current-password" />
              </Field>
              <Field label="Frasa sandi enkripsi" hint="Minimal 8 karakter. Simpan di tempat aman; dibutuhkan untuk memulihkan di perangkat lain.">
                <input type="password" value={form.passphrase} onChange={(event) => setForm({ ...form, passphrase: event.target.value })} autoComplete="new-password" />
              </Field>
              <Field label="Ulangi frasa sandi">
                <input type="password" value={form.passphraseConfirm} onChange={(event) => setForm({ ...form, passphraseConfirm: event.target.value })} autoComplete="new-password" />
              </Field>
            </div>
          </div>
          <div className="owner-backup-actions">
            <button className="owner-primary" onClick={() => void activate()} disabled={busy}>
              <ShieldCheck size={15} /> {busy ? 'Menghubungkan…' : 'Masuk & aktifkan backup cloud'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="owner-metric-list">
            <div><span>Project</span><b>{config?.projectUrl}</b></div>
            <div><span>Outlet</span><b>{config?.outletId}</b></div>
            <div><span>Akun</span><b>{session?.email || 'sesi tidak aktif'}</b></div>
            <div><span>Koneksi otomatis</span><b>{status.lastConnectedAt ? `aktif • ${formatDate(status.lastConnectedAt)}` : session ? 'menunggu pemeriksaan' : 'belum tersambung'}</b></div>
          </div>
          <div className="owner-setting-note">
            <strong>Tersambung otomatis</strong>
            <span>Perangkat ini memakai sesi pemilik yang tersimpan dan memperbarui token di latar belakang, jadi tidak perlu mengisi apa pun lagi setiap aplikasi dibuka. Buka panel ini hanya untuk mengganti akun, frasa sandi, atau memulihkan snapshot.</span>
          </div>
          <div className="owner-backup-actions">
            <button className="owner-primary" onClick={() => void uploadNow()} disabled={busy}><CloudUpload size={15} /> Backup sekarang ke cloud</button>
            <button className="owner-ghost" onClick={() => { if (config && session) void refreshList(config, session) }} disabled={busy || !session}><RefreshCw size={15} /> Muat daftar snapshot</button>
            <button className="owner-ghost" onClick={() => void disconnect()} disabled={busy || !session}><LogOut size={15} /> Putuskan sesi</button>
            <button className="owner-ghost danger" onClick={() => void deactivate()} disabled={busy}><CloudOff size={15} /> Matikan backup cloud</button>
          </div>

          <div className="owner-setting-note">
            <strong>Cara kerja</strong>
            <span>Setiap backup harian dan backup sebelum tutup shift diunggah otomatis setelah tersimpan lokal. Metadata (checksum, path, ukuran, jumlah baris) masuk ke tabel outlet_snapshots; isi backup tidak pernah tersimpan sebagai plaintext di cloud.</span>
          </div>

          {rows.length === 0 ? (
            <div className="owner-setting-note">
              <strong>Belum ada snapshot</strong>
              <span>Riwayat kosong atau daftar belum dimuat. Tekan “Muat daftar snapshot” untuk membaca metadata dari cloud.</span>
            </div>
          ) : (
            <div className="owner-audit-list">
              {rows.map((row) => (
                <div className="owner-audit-row" key={row.id || row.storagePath}>
                  <span className="owner-audit-action">{reasonLabel[row.reason] ?? row.reason}</span>
                  <span className="owner-audit-detail">
                    {formatDate(row.createdAt)} • {formatBytes(row.sizeBytes)} • skema v{row.schemaVersion} • <span className="owner-mono">{row.checksum.slice(0, 12)}</span>
                  </span>
                  <button className="owner-ghost" onClick={() => void restoreRow(row)} disabled={busy}><DownloadCloud size={13} /> Pulihkan</button>
                </div>
              ))}
            </div>
          )}

          <div className="owner-setting-note">
            <strong>Pulihkan di perangkat lain</strong>
            <span>Aktifkan backup cloud di perangkat baru dengan URL project, anon key, UUID outlet, akun pemilik, dan frasa sandi yang sama. Setelah sesi tersambung, daftar snapshot muncul dan bisa dipulihkan dengan pratinjau seperti restore file lokal.</span>
          </div>
        </>
      )}

      <div className="owner-setting-note">
        <strong>Batas Fase 2</strong>
        <span>Cloud hanya salinan satu arah: tidak ada penarikan transaksi, tidak ada realtime, dan konflik katalog belum ditangani. Tanpa konfigurasi, aplikasi tetap 100% lokal. <Link2 size={12} /> <KeyRound size={12} /></span>
      </div>
    </section>
  )
}
