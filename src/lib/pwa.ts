export type PwaStatus = {
  supported: boolean
  production: boolean
  active: boolean
  controller: boolean
  canInstall: boolean
  installed: boolean
  error: string
}

const isBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined'
const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env
const production = env?.PROD === true

let status: PwaStatus = {
  supported: isBrowser && 'serviceWorker' in navigator,
  production,
  active: false,
  controller: isBrowser && 'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller),
  canInstall: false,
  installed: false,
  error: '',
}

const listeners = new Set<(value: PwaStatus) => void>()

function update(patch: Partial<PwaStatus>): void {
  status = { ...status, ...patch }
  for (const listener of listeners) listener(status)
}

export function getPwaStatus(): PwaStatus {
  return status
}

export function subscribePwaStatus(listener: (value: PwaStatus) => void): () => void {
  listeners.add(listener)
  listener(status)
  return () => {
    listeners.delete(listener)
  }
}

function detectInstalled(): boolean {
  if (!isBrowser) return false
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches === true || navigatorWithStandalone.standalone === true
}

let started = false

/** Dipanggil sekali dari main.tsx; tidak pernah menahan render atau boot storage. */
export function registerPwa(): void {
  if (!isBrowser || started) return
  started = true
  update({ installed: detectInstalled(), supported: 'serviceWorker' in navigator })
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    update({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => update({ canInstall: false, installed: true }))
  if (!('serviceWorker' in navigator)) {
    update({ error: 'Browser ini tidak mendukung service worker.' })
    return
  }
  if (!production) {
    update({ error: 'Service worker hanya didaftarkan pada build produksi.' })
    return
  }
  const start = () => { void registerServiceWorker() }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

async function registerServiceWorker(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    update({ active: Boolean(registration.active) })
    navigator.serviceWorker.addEventListener('controllerchange', () => update({ controller: true, active: true }))
    await navigator.serviceWorker.ready
    update({ active: true, controller: Boolean(navigator.serviceWorker.controller) })
  } catch (error) {
    update({ error: error instanceof Error ? error.message : 'Service worker gagal didaftarkan.' })
  }
}

/** Membaca registrasi yang sudah ada (mis. setelah reload) untuk indikator Pengaturan. */
export async function hydratePwaStatus(): Promise<PwaStatus> {
  if (!isBrowser || !('serviceWorker' in navigator)) return status
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    update({ active: Boolean(registration?.active), controller: Boolean(navigator.serviceWorker.controller) })
  } catch {
    // Status tetap memakai nilai terakhir; indikator tidak boleh mengganggu pengaturan.
  }
  return status
}
