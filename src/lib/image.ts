const MAX_EDGE = 560
const QUALITY = 0.78

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Gambar tidak bisa dibaca'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gambar tidak bisa dibuka'))
    image.src = src
  })
}

/**
 * Foto menu disimpan sebagai data URL terkompresi di dalam state IndexedDB
 * dan tetap tampil saat perangkat offline. Rasio asli dipertahankan supaya
 * gambar tidak terdistorsi; tampilan kasir memakai object-fit: contain.
 */
export async function fileToMenuImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pilih file gambar (JPG, PNG, atau WebP)')
  const dataUrl = await readAsDataUrl(file)
  if (typeof document === 'undefined') return dataUrl
  try {
    const image = await loadImage(dataUrl)
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return dataUrl
    context.fillStyle = '#fffaf3'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', QUALITY)
  } catch {
    return dataUrl
  }
}
