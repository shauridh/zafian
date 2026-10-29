/**
 * Jembatan printer untuk shell Android.
 *
 * Android WebView tidak mendukung Web Bluetooth, jadi shell mengekspos
 * `window.SabanaNative` dengan callback berbasis requestId. Modul ini
 * mengubahnya menjadi kontrak `window.SabanaPrinter` yang sudah dipakai
 * `printer-connection.ts`, sehingga logika struk tetap satu jalur.
 */

export type NativePrinterTransport = 'ble' | 'classic'

export type NativePrinterHost = {
  getStatus(): string
  requestPair(requestId: string): void
  requestReconnect(requestId: string, preferredName: string): void
  requestDisconnect(requestId: string): void
  requestSendReceipt(requestId: string, inputJson: string): void
}

type NativePrinterBridge = {
  getStatus(): { connected: boolean; deviceName?: string | null; transport?: NativePrinterTransport | null }
  pair(): Promise<{ deviceName: string; transport?: NativePrinterTransport }>
  reconnect(preferredName?: string): Promise<{ deviceName: string; transport?: NativePrinterTransport }>
  disconnect(): Promise<void>
  sendReceipt(input: { payloads: string[]; copies: number }): Promise<void>
}

type NativeWindow = Window & {
  SabanaNative?: NativePrinterHost
  SabanaPrinter?: NativePrinterBridge
  __sabanaNativeResolve?: (requestId: string, payload: string) => void
}

type RequestMethod = 'requestPair' | 'requestReconnect' | 'requestDisconnect' | 'requestSendReceipt'
type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 30_000
const pending = new Map<string, PendingRequest>()
let sequence = 0

function completeRequest(requestId: string, payload: string): void {
  const entry = pending.get(requestId)
  if (!entry) return
  pending.delete(requestId)
  clearTimeout(entry.timer)
  try {
    const data = JSON.parse(payload) as Record<string, unknown>
    if (data.ok === false) {
      entry.reject(new Error(typeof data.error === 'string' ? data.error : 'Perintah printer gagal'))
      return
    }
    entry.resolve(data)
  } catch {
    entry.reject(new Error('Respons printer tidak valid'))
  }
}

function request(host: NativePrinterHost, method: RequestMethod, args: string[] = []): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const requestId = `sabana-${Date.now()}-${++sequence}`
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('Printer tidak merespons. Coba lagi.'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(requestId, { resolve, reject, timer })
    try {
      const call = host[method] as unknown as (...values: string[]) => void
      call.call(host, requestId, ...args)
    } catch (error) {
      pending.delete(requestId)
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error('Perintah printer gagal'))
    }
  })
}

/** Pasang shim bila shell native tersedia. Tanpa shell, fungsi ini tidak melakukan apa pun. */
export function installNativePrinterShim(host?: NativePrinterHost | null): boolean {
  if (typeof window === 'undefined') return false
  const target = window as NativeWindow
  const bridgeHost = host ?? target.SabanaNative
  if (!bridgeHost) return false
  if (target.SabanaPrinter) return true

  target.__sabanaNativeResolve = completeRequest
  target.SabanaPrinter = {
    getStatus: () => {
      try {
        const status = JSON.parse(bridgeHost.getStatus()) as {
          connected?: boolean
          deviceName?: string | null
          transport?: NativePrinterTransport | null
        }
        return {
          connected: Boolean(status.connected),
          deviceName: status.deviceName ?? null,
          transport: status.transport ?? null,
        }
      } catch {
        return { connected: false, deviceName: null, transport: null }
      }
    },
    pair: () => request(bridgeHost, 'requestPair') as unknown as Promise<{ deviceName: string; transport?: NativePrinterTransport }>,
    reconnect: (preferredName = '') => request(bridgeHost, 'requestReconnect', [preferredName]) as unknown as Promise<{ deviceName: string; transport?: NativePrinterTransport }>,
    disconnect: () => request(bridgeHost, 'requestDisconnect').then(() => undefined),
    sendReceipt: (input) => request(bridgeHost, 'requestSendReceipt', [JSON.stringify(input)]).then(() => undefined),
  }
  return true
}

/** Dilepas setelah pengujian atau saat shell berpindah halaman. */
export function uninstallNativePrinterShim(): void {
  if (typeof window === 'undefined') return
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
    entry.reject(new Error('Bridge printer native dilepas'))
  }
  pending.clear()
  const target = window as NativeWindow
  delete target.SabanaPrinter
  delete target.__sabanaNativeResolve
}

if (typeof window !== 'undefined') installNativePrinterShim()
