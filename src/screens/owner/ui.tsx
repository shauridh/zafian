import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export const money = (value: number) => `Rp${Math.round(value).toLocaleString('id-ID')}`

export function Modal({ eyebrow, title, onClose, children, wide = false }: {
  eyebrow: string
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="modal-backdrop">
      <div className={wide ? 'modal editor' : 'modal owner-modal'} role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-close" onClick={onClose} aria-label="Tutup"><X size={18} /></button>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'owner-field wide' : 'owner-field'}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

/** Untuk grup tombol/segmented control yang tidak boleh dibungkus <label>. */
export function FieldGroup({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'owner-field wide' : 'owner-field'}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="owner-empty">
      <div className="owner-empty-icon">{icon}</div>
      <strong>{title}</strong>
      <span>{hint}</span>
      {action}
    </div>
  )
}
