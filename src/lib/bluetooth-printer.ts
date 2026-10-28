/**
 * Web Bluetooth thermal printer bridge.
 *
 * Works in Chromium-based browsers on Android/desktop over HTTPS (or localhost).
 * Pairing is granted per origin by the browser; `getDevices()` lets us reconnect
 * to a device the cashier already approved without showing the chooser again.
 */
import { buildEscPosPayloads, type EscPosFontSize } from './escpos'

type BluetoothCharacteristic = {
  properties: { write: boolean; writeWithoutResponse: boolean }
  writeValue(value: BufferSource): Promise<void>
  writeValueWithoutResponse?(value: BufferSource): Promise<void>
}

type BluetoothService = {
  getCharacteristics(): Promise<BluetoothCharacteristic[]>
}

type BluetoothGattServer = {
  connected: boolean
  connect(): Promise<BluetoothGattServer>
  disconnect(): void
  getPrimaryServices(): Promise<BluetoothService[]>
}

type BluetoothDevice = {
  id: string
  name?: string
  gatt?: BluetoothGattServer
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void
}

type BluetoothApi = {
  requestDevice(options: { acceptAllDevices: boolean; optionalServices?: string[] }): Promise<BluetoothDevice>
  getDevices?(): Promise<BluetoothDevice[]>
}

export type BluetoothPrinter = { id: string; name: string }

const PRINTER_SERVICES = [
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ffe5-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
]

let activeDevice: BluetoothDevice | null = null
let activeCharacteristic: BluetoothCharacteristic | null = null

function bluetoothApi(): BluetoothApi | null {
  if (typeof navigator === 'undefined') return null
  const api = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth
  return api ?? null
}

export function isBluetoothSupported(): boolean {
  if (!bluetoothApi()) return false
  if (typeof window !== 'undefined' && window.isSecureContext === false) return false
  return true
}

function connectionName(device: BluetoothDevice): string {
  return device.name?.trim() || 'Printer Bluetooth'
}

async function writableCharacteristic(device: BluetoothDevice): Promise<BluetoothCharacteristic> {
  const server = device.gatt
  if (!server) throw new Error('Perangkat ini tidak mendukung koneksi GATT')
  if (!server.connected) await server.connect()
  const services = await server.getPrimaryServices()
  for (const service of services) {
    try {
      const characteristics = await service.getCharacteristics()
      const writable = characteristics.find((item) => item.properties.writeWithoutResponse || item.properties.write)
      if (writable) return writable
    } catch {
      // Some advertised services cannot be inspected; continue with the next one.
    }
  }
  throw new Error('Printer tidak memiliki karakteristik tulis. Pastikan perangkat adalah printer thermal.')
}

async function connectDevice(device: BluetoothDevice): Promise<BluetoothPrinter> {
  try {
    const characteristic = await writableCharacteristic(device)
    activeDevice = device
    activeCharacteristic = characteristic
    device.addEventListener('gattserverdisconnected', () => {
      if (activeDevice?.id === device.id) {
        activeDevice = null
        activeCharacteristic = null
      }
    })
    return { id: device.id, name: connectionName(device) }
  } catch (error) {
    try { device.gatt?.disconnect() } catch { /* already disconnected */ }
    throw error
  }
}

function friendlyError(error: unknown, fallback: string): string {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    if (error.name === 'NotFoundError') return 'Pencarian printer dibatalkan atau tidak ada printer dipilih'
    if (error.name === 'SecurityError') return 'Bluetooth diblokir. Buka aplikasi lewat HTTPS dan izinkan Bluetooth.'
    if (error.name === 'NetworkError') return 'Printer gagal terhubung. Nyalakan printer dan coba lagi.'
  }
  return error instanceof Error ? error.message : fallback
}

/** Buka pemilih perangkat Bluetooth, lalu hubungkan printer thermal. */
export async function requestBluetoothPrinter(): Promise<BluetoothPrinter> {
  const api = bluetoothApi()
  if (!api) throw new Error('Web Bluetooth tidak tersedia di browser ini')
  try {
    const device = await api.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES })
    return await connectDevice(device)
  } catch (error) {
    throw new Error(friendlyError(error, 'Gagal memasangkan printer Bluetooth'))
  }
}

/** Hubungkan ulang printer yang sudah pernah diizinkan untuk origin ini. */
export async function connectPermittedPrinter(preferredName = ''): Promise<BluetoothPrinter> {
  const api = bluetoothApi()
  if (!api) throw new Error('Web Bluetooth tidak tersedia di browser ini')
  if (!api.getDevices) throw new Error('Browser tidak mendukung reconnect otomatis. Pasangkan ulang printer.')
  try {
    const devices = await api.getDevices()
    if (devices.length === 0) throw new Error('Belum ada printer yang diizinkan. Klik Cari & pasangkan.')
    const device = devices.find((item) => item.name === preferredName) ?? devices[0]
    return await connectDevice(device)
  } catch (error) {
    throw new Error(friendlyError(error, 'Gagal menghubungkan ulang printer'))
  }
}

export function getBluetoothPrinterName(): string | null {
  return activeDevice ? connectionName(activeDevice) : null
}

export function isBluetoothPrinterConnected(): boolean {
  return Boolean(activeCharacteristic && activeDevice?.gatt?.connected)
}

export function disconnectBluetoothPrinter(): void {
  try { activeDevice?.gatt?.disconnect() } catch { /* ignore */ }
  activeDevice = null
  activeCharacteristic = null
}

async function writeChunks(characteristic: BluetoothCharacteristic, bytes: Uint8Array): Promise<void> {
  const chunkSize = 20
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.slice(offset, offset + chunkSize)
    if (characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(chunk)
    else await characteristic.writeValue(chunk)
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

/** Kirim teks struk ke printer yang sedang terhubung, termasuk ukuran font pilihan pemilik. */
export async function sendReceiptTextToBluetooth(text: string, copies = 1, fontSize: EscPosFontSize = 'normal'): Promise<void> {
  if (!activeCharacteristic || !activeDevice?.gatt?.connected) {
    activeCharacteristic = null
    activeDevice = null
    throw new Error('Printer Bluetooth belum terhubung')
  }
  for (const payload of buildEscPosPayloads(text, copies, fontSize)) {
    await writeChunks(activeCharacteristic, payload)
  }
}
