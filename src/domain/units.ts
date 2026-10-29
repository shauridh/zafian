/**
 * Daftar satuan bahan baku. Dipakai untuk dropdown "Satuan pakai" dan
 * "Satuan pembelian" agar kasir tidak salah ketik dan konversi stok konsisten.
 */
export const UNIT_OPTIONS = [
  'gram',
  'kg',
  'ons',
  'ml',
  'liter',
  'pcs',
  'potong',
  'slice',
  'sachet',
  'lembar',
  'porsi',
  'butir',
  'ikat',
  'sdm',
  'sdt',
  'botol',
  'kaleng',
  'box',
  'pack',
  'karung',
  'pouch',
  'ekor',
  'tabung',
  'lusin',
  'unit',
] as const

/**
 * Satuan lama (mis. "pack 1 kg" atau "ekor (9 potong)") tetap dimasukkan
 * sebagai opsi agar nilai yang sudah tersimpan tidak hilang saat diedit.
 */
export function unitOptionsWithCurrent(current: string): string[] {
  const value = current.trim()
  return value && !(UNIT_OPTIONS as readonly string[]).includes(value) ? [...UNIT_OPTIONS, value] : [...UNIT_OPTIONS]
}
