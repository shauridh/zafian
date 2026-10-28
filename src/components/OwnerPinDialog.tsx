import { useState } from 'react'
import { KeyRound, ShieldCheck, X } from 'lucide-react'

import type { OwnerPinRecord } from '../domain/settings'
import {
  createOwnerPin,
  formatRecoveryCode,
  normalizePin,
  normalizeRecoveryCode,
  validatePin,
  verifyOwnerPin,
  verifyRecoveryCode,
} from '../lib/pin'

type Mode = 'setup' | 'enter' | 'reset' | 'change'

type Props = {
  mode: Mode
  record?: OwnerPinRecord
  purpose?: string
  onSave?: (record: OwnerPinRecord) => void
  onDone: () => void
  onCancel: () => void
}

const titles: Record<Mode, string> = {
  setup: 'Buat PIN pemilik',
  enter: 'PIN pemilik',
  reset: 'Pulihkan akses pemilik',
  change: 'Ubah PIN pemilik',
}

const actions: Record<Mode, string> = {
  setup: 'Buat PIN',
  enter: 'Buka',
  reset: 'Pulihkan & buat PIN',
  change: 'Simpan PIN baru',
}

export function OwnerPinDialog({ mode: initialMode, record, purpose, onSave, onDone, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [currentPin, setCurrentPin] = useState('')
  const [pin, setPin] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [generated, setGenerated] = useState<{ record: OwnerPinRecord; recoveryCode: string } | null>(null)

  const submit = async () => {
    setError('')
    if (mode === 'enter') {
      if (!record) { setError('PIN pemilik belum diatur.'); return }
      setBusy(true)
      try {
        const valid = await verifyOwnerPin(record, pin)
        if (!valid) { setError('PIN salah. Coba lagi.'); return }
        onDone()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'PIN tidak bisa diverifikasi.')
      } finally {
        setBusy(false)
      }
      return
    }

    if (mode === 'reset') {
      if (!record) { setError('PIN pemilik belum diatur.'); return }
      if (normalizeRecoveryCode(recoveryInput).length !== 12) { setError('Kode pemulihan harus 12 karakter.'); return }
    }

    if (mode === 'change') {
      if (!record) { setError('PIN pemilik belum diatur.'); return }
      setBusy(true)
      try {
        const valid = await verifyOwnerPin(record, currentPin)
        if (!valid) { setError('PIN saat ini salah.'); return }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'PIN tidak bisa diverifikasi.')
        return
      } finally {
        setBusy(false)
      }
    }

    const pinError = validatePin(pin)
    if (pinError) { setError(pinError); return }
    if (pin !== confirmation) { setError('Konfirmasi PIN tidak sama.'); return }

    setBusy(true)
    try {
      if (mode === 'reset') {
        const validCode = await verifyRecoveryCode(record, recoveryInput)
        if (!validCode) { setError('Kode pemulihan salah.'); return }
      }
      const next = await createOwnerPin(pin)
      setGenerated({ record: next.record, recoveryCode: next.recoveryCode })
      setPin('')
      setConfirmation('')
      setCurrentPin('')
      setRecoveryInput('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'PIN gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  if (generated) {
    return (
      <div className="modal-backdrop">
        <div className="modal small pin-modal" role="dialog" aria-modal="true" aria-label="Kode pemulihan PIN">
          <span className="owner-stat-icon"><ShieldCheck size={18} /></span>
          <span className="eyebrow">KESELAMATAN AKSES</span>
          <h2>Simpan kode pemulihan</h2>
          <p className="modal-muted">Kode ini hanya ditampilkan sekali. Simpan di tempat aman; kode dipakai jika PIN pemilik lupa. Jangan berikan kepada kasir.</p>
          <div className="pin-recovery-code" data-recovery-code={generated.recoveryCode} aria-label="Kode pemulihan">{formatRecoveryCode(generated.recoveryCode)}</div>
          <p className="modal-muted">PIN dan kode disimpan sebagai hash SHA-256. Kode asli tidak bisa ditampilkan lagi setelah dialog ditutup.</p>
          <button className="checkout-btn" onClick={() => { onSave?.(generated.record); onDone() }}>Saya sudah menyimpan kode</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop">
      <div className="modal small pin-modal" role="dialog" aria-modal="true" aria-label={titles[mode]}>
        {mode !== 'reset' && <button className="modal-close" onClick={onCancel} aria-label="Tutup PIN"><X /></button>}
        <span className="owner-stat-icon"><KeyRound size={18} /></span>
        <span className="eyebrow">AKSES PEMILIK</span>
        <h2>{titles[mode]}</h2>
        <p className="modal-muted">
          {mode === 'enter' && `Masukkan PIN untuk ${purpose ?? 'membuka mode pemilik'}.`}
          {mode === 'setup' && 'PIN melindungi menu, harga, pengaturan, void, dan tutup shift. Kasir tetap bisa berjualan tanpa PIN.'}
          {mode === 'reset' && 'Masukkan kode pemulihan yang disimpan saat PIN dibuat, lalu tentukan PIN baru.'}
          {mode === 'change' && 'Masukkan PIN saat ini, lalu tentukan PIN baru. Kode pemulihan lama akan diganti.'}
        </p>

        {mode === 'change' && (
          <label className="pin-field">
            <span>PIN saat ini</span>
            <input type="password" inputMode="numeric" autoComplete="current-password" value={currentPin} onChange={(event) => setCurrentPin(normalizePin(event.target.value))} aria-label="PIN saat ini" />
          </label>
        )}

        {mode === 'reset' && (
          <label className="pin-field">
            <span>Kode pemulihan</span>
            <input value={recoveryInput} onChange={(event) => setRecoveryInput(normalizeRecoveryCode(event.target.value))} placeholder="XXXX-XXXX-XXXX" autoComplete="one-time-code" aria-label="Kode pemulihan" />
          </label>
        )}

        <label className="pin-field">
          <span>{mode === 'enter' ? 'PIN' : 'PIN baru'}</span>
          <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(event) => setPin(normalizePin(event.target.value))} aria-label={mode === 'enter' ? 'PIN pemilik' : 'PIN baru'} />
        </label>

        {mode !== 'enter' && (
          <label className="pin-field">
            <span>Ulangi PIN</span>
            <input type="password" inputMode="numeric" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(normalizePin(event.target.value))} aria-label="Ulangi PIN" />
          </label>
        )}

        {error && <p className="pin-error" role="alert">{error}</p>}

        <button className="checkout-btn" onClick={() => void submit()} disabled={busy}>{busy ? 'Memproses…' : actions[mode]}</button>
        {mode === 'enter' && <button className="pin-link" onClick={() => { setMode('reset'); setError('') }}>Lupa PIN? Pulihkan dengan kode</button>}
        {mode === 'reset' && <button className="pin-link" onClick={() => { setMode('enter'); setError('') }}>Kembali ke PIN</button>}
        {mode !== 'reset' && <button className="pin-link" onClick={onCancel}>Batal</button>}
        {mode === 'setup' && <p className="pin-hint">Minimal 4 digit. Kode pemulihan akan ditampilkan sekali setelah PIN dibuat.</p>}
      </div>
    </div>
  )
}
