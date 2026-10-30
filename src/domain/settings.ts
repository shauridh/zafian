export type ThemeMode = 'light' | 'dark'
export type ReceiptAlign = 'left' | 'center'
export type ReceiptFontSize = 'compact' | 'normal' | 'large'

export type PrinterSettings = {
  /** Nama perangkat untuk referensi kasir, mis. "Thermal 58mm Kasir 1". */
  deviceName: string
  paperWidth: 58 | 80
  /** Cetak struk otomatis setelah pembayaran tunai/QRIS. */
  autoPrint: boolean
  /** Tata letak teks struk. */
  headerAlign: ReceiptAlign
  footerAlign: ReceiptAlign
  fontSize: ReceiptFontSize
  showOrderType: boolean
  showPaymentDetail: boolean
  /** Jumlah salinan struk per transaksi (1–3). */
  copies: number
}

export type AppSettings = {
  businessName: string
  outletName: string
  /** Nomor telepon outlet, tampil di bawah nama outlet dan pada struk. */
  outletPhone: string
  receiptFooter: string
  /** Baris promo opsional di atas catatan kaki; satu baris per baris. */
  receiptPromo: string
  /**
   * Pemakaian standar per porsi untuk tiap bahan (id bahan → jumlah dalam
   * satuan pakai). Dipakai untuk mengisi otomatis jumlah bahan saat resep menu
   * baru disusun, sehingga gramasi yang sama tidak perlu diketik ulang.
   */
  ingredientUsage?: Record<string, number>
  theme: ThemeMode
  printer: PrinterSettings
}

export const defaultSettings: AppSettings = {
  businessName: 'SABANA FRIED CHICKEN',
  outletName: 'Outlet utama',
  outletPhone: '',
  receiptFooter: 'Terima kasih • Sabana POS',
  receiptPromo: '',
  theme: 'light',
  printer: {
    deviceName: '',
    paperWidth: 58,
    autoPrint: false,
    headerAlign: 'left',
    footerAlign: 'left',
    fontSize: 'normal',
    showOrderType: true,
    showPaymentDetail: true,
    copies: 1,
  },
}

export function createDefaultSettings(): AppSettings {
  return { ...defaultSettings, printer: { ...defaultSettings.printer } }
}
