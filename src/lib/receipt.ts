import type { AppSettings, ReceiptAlign, ReceiptFontSize } from '../domain/settings'
import type { Transaction } from '../domain/pos'
import { getPrinterTransportStatus, sendReceiptText } from './printer-connection'

export type ReceiptBranding = {
  businessName?: string
  outletName?: string
  footer?: string
  promo?: string
  paperWidth?: 58 | 80
  headerAlign?: ReceiptAlign
  footerAlign?: ReceiptAlign
  fontSize?: ReceiptFontSize
  showOrderType?: boolean
  showPaymentDetail?: boolean
  copies?: number
}

const fallback: Required<ReceiptBranding> = {
  businessName: 'SABANA FRIED CHICKEN',
  outletName: 'Outlet utama',
  footer: 'Terima kasih',
  promo: '',
  paperWidth: 58,
  headerAlign: 'left',
  footerAlign: 'left',
  fontSize: 'normal',
  showOrderType: true,
  showPaymentDetail: true,
  copies: 1,
}

const money = (value: number) => `Rp${value.toLocaleString('id-ID')}`

function resolveBranding(branding: ReceiptBranding = {}): Required<ReceiptBranding> {
  return {
    businessName: branding.businessName?.trim() || fallback.businessName,
    outletName: branding.outletName?.trim() || fallback.outletName,
    footer: branding.footer?.trim() || fallback.footer,
    promo: branding.promo?.trim() ?? '',
    paperWidth: branding.paperWidth === 80 ? 80 : fallback.paperWidth,
    headerAlign: branding.headerAlign === 'center' ? 'center' : fallback.headerAlign,
    footerAlign: branding.footerAlign === 'center' ? 'center' : fallback.footerAlign,
    fontSize: branding.fontSize === 'compact' || branding.fontSize === 'large' ? branding.fontSize : fallback.fontSize,
    showOrderType: branding.showOrderType !== false,
    showPaymentDetail: branding.showPaymentDetail !== false,
    copies: Math.min(3, Math.max(1, Math.trunc(branding.copies ?? fallback.copies))),
  }
}

export function brandingFromSettings(settings: AppSettings): ReceiptBranding {
  return {
    businessName: settings.businessName,
    outletName: settings.outletName,
    footer: settings.receiptFooter,
    promo: settings.receiptPromo,
    paperWidth: settings.printer.paperWidth,
    headerAlign: settings.printer.headerAlign,
    footerAlign: settings.printer.footerAlign,
    fontSize: settings.printer.fontSize,
    showOrderType: settings.printer.showOrderType,
    showPaymentDetail: settings.printer.showPaymentDetail,
    copies: settings.printer.copies,
  }
}

function alignLine(text: string, width: number, align: ReceiptAlign): string {
  const clipped = text.length > width ? text.slice(0, width) : text
  if (align === 'left') return clipped
  return `${' '.repeat(Math.max(0, Math.floor((width - clipped.length) / 2)))}${clipped}`
}

/** Bungkus teks per kata agar tidak terpotong oleh lebar kertas thermal. */
function wrapLine(text: string, width: number): string[] {
  const lines: string[] = []
  let rest = text.trim()
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width)
    if (cut <= 0) cut = width
    lines.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) lines.push(rest)
  return lines
}

/** Teks struk siap kirim ke printer thermal 58/80 mm. */
export function buildReceiptText(transaction: Transaction, branding: ReceiptBranding = {}): string {
  const config = resolveBranding(branding)
  const width = config.paperWidth === 80 ? 42 : 32
  const line = '-'.repeat(width)
  const row = (label: string, value: string) => `${label}${' '.repeat(Math.max(1, width - label.length - value.length))}${value}`
  const rows: string[] = []
  rows.push(alignLine(config.businessName.toUpperCase(), width, config.headerAlign))
  if (config.outletName) rows.push(alignLine(config.outletName, width, config.headerAlign))
  rows.push(line)
  rows.push(transaction.number)
  rows.push(new Date(transaction.createdAt).toLocaleString('id-ID'))
  if (config.showOrderType) rows.push(`Tipe: ${transaction.orderType}`)
  rows.push(line)
  for (const item of transaction.items) {
    const label = `${item.qty}x ${item.name}`
    rows.push(label.length > width ? `${label.slice(0, width - 1)}…` : label)
    const amount = money(item.price * item.qty)
    rows.push(row('', amount))
  }
  rows.push(line)
  rows.push(row('TOTAL', money(transaction.subtotal)))
  if (config.showPaymentDetail) {
    rows.push(row('BAYAR', money(transaction.paidAmount)))
    rows.push(row('KEMBALI', money(transaction.change)))
    rows.push(`Metode: ${transaction.paymentMethod}`)
  }
  if (transaction.status !== 'completed') rows.push(`STATUS: ${transaction.status.toUpperCase()}`)
  rows.push(line)
  for (const footerLine of config.footer.split('\n')) rows.push(alignLine(footerLine, width, config.footerAlign))
  const promoLines = config.promo.split('\n').map((promoLine) => promoLine.trim()).filter(Boolean).slice(0, 3)
  if (promoLines.length > 0) {
    rows.push(line)
    for (const promoLine of promoLines) {
      for (const wrapped of wrapLine(promoLine, width)) rows.push(alignLine(wrapped, width, 'center'))
    }
  }
  return rows.join('\n')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function openReceiptWindow(title: string, text: string, config: Required<ReceiptBranding>): boolean {
  if (typeof window === 'undefined') return false
  const width = config.paperWidth === 80 ? '80mm' : '58mm'
  const baseSize = config.paperWidth === 80 ? 12 : 11
  const fontSize = config.fontSize === 'compact' ? baseSize - 1 : config.fontSize === 'large' ? baseSize + 2 : baseSize
  const lineHeight = config.fontSize === 'compact' ? 1.3 : config.fontSize === 'large' ? 1.55 : 1.45
  const win = window.open('', '_blank', 'width=420,height=680')
  if (!win) return false
  const copies = Array.from({ length: config.copies }, () => `<pre>${escapeHtml(text)}</pre>`).join('')
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>\n    @page { size: ${width} auto; margin: 3mm; }\n    body { margin: 0; width: ${width}; padding: 0; background: #fff; color: #000; }\n    pre { margin: 0; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: ${fontSize}px; line-height: ${lineHeight}; white-space: pre-wrap; page-break-after: always; }\n    pre:last-child { page-break-after: auto; }\n  </style></head><body>${copies}</body></html>`)
  win.document.close()
  win.focus()
  win.print()
  return true
}

export type PrintOutcome =
  | { mode: 'native'; deviceName: string }
  | { mode: 'bluetooth'; deviceName: string }
  | { mode: 'dialog' }
  | { mode: 'blocked' }
  | { mode: 'failed'; error: string }

export function printOutcomeMessage(outcome: PrintOutcome): string {
  if (outcome.mode === 'native') return `Struk dikirim ke ${outcome.deviceName} (native)`
  if (outcome.mode === 'bluetooth') return `Struk dikirim ke ${outcome.deviceName} (Bluetooth)`
  if (outcome.mode === 'dialog') return 'Dialog cetak dibuka • pilih printer thermal'
  if (outcome.mode === 'failed') return `Cetak printer gagal: ${outcome.error}`
  return 'Dialog cetak diblokir browser/WebView'
}

async function printTextPreferred(text: string, title: string, branding: ReceiptBranding = {}): Promise<PrintOutcome> {
  const config = resolveBranding(branding)
  const active = getPrinterTransportStatus()
  // Native boleh dicoba saat status terputus: bridge akan auto-connect ke
  // printer tersimpan sebelum menulis payload.
  if (active.kind === 'native' || active.canSend) {
    try {
      await sendReceiptText(text, config.copies, config.fontSize)
      const deviceName = active.deviceName ?? 'Printer thermal'
      return { mode: active.kind === 'native' ? 'native' : 'bluetooth', deviceName }
    } catch (error) {
      return { mode: 'failed', error: error instanceof Error ? error.message : 'Gagal mengirim ke printer' }
    }
  }
  return openReceiptWindow(title, text, config) ? { mode: 'dialog' } : { mode: 'blocked' }
}

/** Cetak lewat printer Bluetooth jika terhubung; jika tidak, pakai dialog print WebView. */
export function printReceiptPreferred(transaction: Transaction, branding: ReceiptBranding = {}): Promise<PrintOutcome> {
  return printTextPreferred(buildReceiptText(transaction, branding), transaction.number, branding)
}

function testTransaction(): Transaction {
  return {
    id: 'test-print',
    number: 'TES-PRINTER',
    createdAt: new Date().toISOString(),
    orderType: 'Takeaway',
    paymentMethod: 'Cash',
    items: [{ id: 'contoh', name: 'Contoh menu', category: 'Contoh', price: 15000, qty: 1 }],
    subtotal: 15000,
    paidAmount: 20000,
    change: 5000,
    status: 'completed',
    shiftId: '',
  }
}

export function buildTestReceiptText(branding: ReceiptBranding = {}): string {
  return buildReceiptText(testTransaction(), branding)
}

export function printTestReceiptPreferred(branding: ReceiptBranding = {}): Promise<PrintOutcome> {
  return printTextPreferred(buildTestReceiptText(branding), 'Tes printer', branding)
}
