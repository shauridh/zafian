import {
  connectPermittedPrinter,
  disconnectBluetoothPrinter,
  getBluetoothPrinterName,
  isBluetoothPrinterConnected,
  isBluetoothSupported,
  requestBluetoothPrinter,
  sendReceiptTextToBluetooth,
} from './bluetooth-printer'
import { buildEscPosPayloads, bytesToBase64, type EscPosFontSize } from './escpos'

export type PrinterTransportKind = 'native' | 'web-bluetooth' | 'system'
export type NativePrinterLink = 'ble' | 'classic'

/**
 * Contract for an optional native shell. A Capacitor Android wrapper can register
 * window.SabanaPrinter and forward these calls to a BLE or Classic/SPP plugin.
 * The payloads are complete ESC/POS copies encoded as base64, so native code only
 * writes bytes and never re-implements receipt formatting.
 */
export type NativePrinterBridge = {
  getStatus(): { connected: boolean; deviceName?: string | null; transport?: NativePrinterLink }
  pair(): Promise<{ deviceName: string; transport?: NativePrinterLink }>
  reconnect?(preferredName?: string): Promise<{ deviceName: string; transport?: NativePrinterLink }>
  disconnect?(): Promise<void> | void
  sendReceipt(input: { payloads: string[]; copies: number }): Promise<void>
}

export type PrinterConnectionStatus = {
  kind: PrinterTransportKind
  label: string
  connected: boolean
  deviceName: string | null
  canPair: boolean
  canReconnect: boolean
  canDisconnect: boolean
  canSend: boolean
  diagnostic: string
}

export type PrinterConnection = { deviceName: string; kind: PrinterTransportKind }

type NativeWindow = Window & { SabanaPrinter?: NativePrinterBridge }

function nativeBridge(): NativePrinterBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as NativeWindow).SabanaPrinter
  return bridge && typeof bridge.pair === 'function' && typeof bridge.sendReceipt === 'function' ? bridge : null
}

function nativeLabel(link: NativePrinterLink | undefined): string {
  return link === 'classic' ? 'Native Bluetooth Classic/SPP' : 'Native Bluetooth BLE'
}

export function getPrinterTransportStatus(): PrinterConnectionStatus {
  const native = nativeBridge()
  if (native) {
    try {
      const state = native.getStatus()
      const label = nativeLabel(state.transport)
      return {
        kind: 'native',
        label,
        connected: state.connected,
        deviceName: state.deviceName?.trim() || null,
        canPair: true,
        canReconnect: Boolean(native.reconnect),
        canDisconnect: Boolean(native.disconnect) && state.connected,
        canSend: state.connected,
        diagnostic: state.connected
          ? `Printer terhubung lewat bridge native (${state.transport === 'classic' ? 'Bluetooth Classic/SPP' : 'BLE'}).`
          : 'Bridge native terdeteksi, tetapi printer belum terhubung. Gunakan Cari & pasangkan atau Hubungkan ulang.',
      }
    } catch {
      return {
        kind: 'native',
        label: 'Native printer',
        connected: false,
        deviceName: null,
        canPair: true,
        canReconnect: Boolean(native.reconnect),
        canDisconnect: false,
        canSend: false,
        diagnostic: 'Bridge native tidak merespons. Periksa implementasi window.SabanaPrinter di shell Android.',
      }
    }
  }

  if (isBluetoothSupported()) {
    const connected = isBluetoothPrinterConnected()
    return {
      kind: 'web-bluetooth',
      label: 'Web Bluetooth (BLE)',
      connected,
      deviceName: connected ? getBluetoothPrinterName() : null,
      canPair: true,
      canReconnect: true,
      canDisconnect: connected,
      canSend: connected,
      diagnostic: connected
        ? 'Printer BLE terhubung lewat Web Bluetooth.'
        : 'Web Bluetooth tersedia (Chrome/Edge, HTTPS). Pasangkan printer BLE atau gunakan dialog cetak sistem.',
    }
  }

  return {
    kind: 'system',
    label: 'Dialog cetak sistem',
    connected: false,
    deviceName: null,
    canPair: false,
    canReconnect: false,
    canDisconnect: false,
    canSend: false,
    diagnostic: 'Runtime ini tidak menyediakan bridge native maupun Web Bluetooth aktif (Chrome/Edge + HTTPS). Pairing tidak tersedia; struk dicetak lewat dialog cetak sistem/WebView.',
  }
}

export async function pairPrinter(): Promise<PrinterConnection> {
  const native = nativeBridge()
  if (native) {
    const printer = await native.pair()
    return { deviceName: printer.deviceName, kind: 'native' }
  }
  if (isBluetoothSupported()) {
    const printer = await requestBluetoothPrinter()
    return { deviceName: printer.name, kind: 'web-bluetooth' }
  }
  throw new Error(getPrinterTransportStatus().diagnostic)
}

export async function reconnectPrinter(preferredName = ''): Promise<PrinterConnection> {
  const native = nativeBridge()
  if (native) {
    if (!native.reconnect) throw new Error('Bridge native belum menyediakan reconnect. Pasangkan ulang printer.')
    const printer = await native.reconnect(preferredName)
    return { deviceName: printer.deviceName, kind: 'native' }
  }
  if (isBluetoothSupported()) {
    const printer = await connectPermittedPrinter(preferredName)
    return { deviceName: printer.name, kind: 'web-bluetooth' }
  }
  throw new Error(getPrinterTransportStatus().diagnostic)
}

export async function disconnectPrinter(): Promise<void> {
  const native = nativeBridge()
  if (native) {
    await native.disconnect?.()
    return
  }
  disconnectBluetoothPrinter()
}

/** Kirim struk lewat transport aktif. Payload ESC/POS dibentuk sekali di escpos.ts. */
export async function sendReceiptText(text: string, copies = 1, fontSize: EscPosFontSize = 'normal'): Promise<void> {
  const native = nativeBridge()
  if (native) {
    const state = native.getStatus()
    if (!state.connected) throw new Error('Printer native belum terhubung')
    const payloads = buildEscPosPayloads(text, copies, fontSize)
    await native.sendReceipt({ payloads: payloads.map(bytesToBase64), copies: payloads.length })
    return
  }
  if (isBluetoothSupported() && isBluetoothPrinterConnected()) {
    await sendReceiptTextToBluetooth(text, copies, fontSize)
    return
  }
  throw new Error(getPrinterTransportStatus().diagnostic)
}
