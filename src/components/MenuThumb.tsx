import { useState } from 'react'

type Props = {
  name: string
  emoji?: string
  imageUrl?: string
  className?: string
}

/**
 * Foto menu selalu ditampilkan utuh lewat object-fit: contain.
 * Jika aset hilang atau gagal dimuat, emoji menjadi fallback yang tetap terlihat.
 */
export function MenuThumb({ name, emoji, imageUrl, className }: Props) {
  // Simpan URL yang gagal, bukan boolean, agar foto pengganti langsung dicoba lagi.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (!imageUrl || failedUrl === imageUrl) return <span className={className ? `menu-emoji ${className}` : 'menu-emoji'} aria-hidden>{emoji || '🍽️'}</span>
  return <img className={className ? `menu-image ${className}` : 'menu-image'} src={imageUrl} alt={name} loading="lazy" draggable={false} onError={() => setFailedUrl(imageUrl)} />
}
