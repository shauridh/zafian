/**
 * One ESC/POS payload implementation shared by every printer transport.
 * Native bridges receive base64 copies of these bytes instead of re-encoding text.
 */

export function toPrinterAscii(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\t\n\r\x20-\x7e]/g, '')
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

export type EscPosFontSize = 'compact' | 'normal' | 'large'

/**
 * ESC ! memilih mode cetak: Font B (karakter lebih kecil) untuk ukuran compact,
 * tinggi ganda untuk large. Lebar kolom tidak berubah supaya tata letak 58/80 mm
 * tetap sama seperti pratinjau struk.
 */
function fontCommand(fontSize: EscPosFontSize): Uint8Array {
  const mode = fontSize === 'compact' ? 0x01 : fontSize === 'large' ? 0x10 : 0x00
  return Uint8Array.from([0x1b, 0x21, mode])
}

/** Satu salinan struk: inisialisasi, ukuran font, teks, umpan kertas, lalu potong. */
export function buildEscPosPayload(text: string, fontSize: EscPosFontSize = 'normal'): Uint8Array {
  const body = new TextEncoder().encode(toPrinterAscii(text).replace(/\r/g, ''))
  return concatBytes([
    Uint8Array.from([0x1b, 0x40]),
    fontCommand(fontSize),
    body,
    Uint8Array.from([0x0a, 0x0a, 0x0a, 0x0a]),
    Uint8Array.from([0x1d, 0x56, 0x00]),
  ])
}

export function buildEscPosPayloads(text: string, copies = 1, fontSize: EscPosFontSize = 'normal'): Uint8Array[] {
  const count = Math.min(3, Math.max(1, Math.trunc(copies)))
  return Array.from({ length: count }, () => buildEscPosPayload(text, fontSize))
}

/** Base64 untuk bridge native; setiap entri adalah satu salinan lengkap. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
