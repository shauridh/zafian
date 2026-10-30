import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Perilaku dialog: fokus masuk ke kolom pertama, Tab berputar di dalam dialog,
 * Escape menutup, dan fokus kembali ke pemicu saat dialog selesai.
 * Dipakai bersama oleh Dialog dan Modal/ConfirmDialog mode pemilik.
 */
export function useDialogFocus(containerRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof document === 'undefined') return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusables = () => {
      const all = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
      const visible = all.filter((element) => element.getClientRects().length > 0)
      return visible.length > 0 ? visible : all
    }

    // Kolom isian lebih berguna daripada tombol tutup sebagai fokus awal.
    const initial = node.querySelector<HTMLElement>('[data-autofocus]')
      ?? node.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select')
      ?? focusables()[0]
      ?? node
    if (initial === node && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
    initial.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (event.shiftKey && (current === first || !node.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || !node.contains(current))) {
        event.preventDefault()
        first.focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [containerRef])
}

type Variant = 'default' | 'small' | 'history'

const variantClass: Record<Variant, string> = {
  default: 'modal',
  small: 'modal small',
  history: 'modal history-modal',
}

/**
 * Dialog POS. Semua modal kasir memakai komponen ini supaya nama, peran, dan
 * perilaku keyboard konsisten (sebelumnya sepuluh dialog ditulis terpisah).
 */
export function Dialog({ eyebrow, heading, label, onClose, variant = 'default', children }: {
  eyebrow?: string
  heading?: string
  label?: string
  onClose: () => void
  variant?: Variant
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose)

  return (
    <div className="modal-backdrop">
      <div className={variantClass[variant]} role="dialog" aria-modal="true" aria-label={label ?? heading} ref={ref}>
        <button className="modal-close" onClick={onClose} aria-label="Tutup">
          <X size={20} />
        </button>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        {heading && <h2>{heading}</h2>}
        {children}
      </div>
    </div>
  )
}
