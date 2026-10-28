import type { PosStore } from '../domain/pos'
import type { RepoGateway } from './repo/gateway'
import { saveStore } from './repo/snapshot'

/**
 * Driver penyimpanan online. Semua perubahan store aplikasi dikirim ke Supabase
 * (bukan ke IndexedDB) ketika mode online aktif. Tidak ada antrean offline:
 * bila jaringan gagal, promise ditolak agar UI menampilkan error dan pengguna
 * bisa mencoba lagi — sumber kebenaran tetap database.
 */
export type OnlineDriver = {
  save(store: PosStore): Promise<void>
  flush(): Promise<void>
}

let activeDriver: OnlineDriver | null = null

export function setOnlineDriver(driver: OnlineDriver | null): void {
  activeDriver = driver
}

export function getOnlineDriver(): OnlineDriver | null {
  return activeDriver
}

export function isOnlineMode(): boolean {
  return activeDriver !== null
}

let signOutHandler: (() => Promise<void>) | null = null

/** Didaftarkan oleh OnlineApp agar pengaturan bisa menawarkan tombol keluar. */
export function setOnlineSignOutHandler(handler: (() => Promise<void>) | null): void {
  signOutHandler = handler
}

export async function signOutOnline(): Promise<void> {
  if (!signOutHandler) throw new Error('Keluar akun hanya tersedia saat mode online aktif.')
  await signOutHandler()
}

type Waiter = { resolve: () => void; reject: (error: unknown) => void }

export function createOnlineDriver(
  gateway: RepoGateway,
  outletId: string,
  initial: PosStore | null,
  debounceMs = 350,
): OnlineDriver {
  let previous = initial
  let queued: PosStore | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> = Promise.resolve()
  let waiters: Waiter[] = []

  const flush = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!queued) return running

    const nextStore = queued
    queued = null
    const pending = waiters
    waiters = []

    running = running.catch(() => undefined).then(async () => {
      try {
        await saveStore(gateway, outletId, nextStore, previous)
        previous = nextStore
        pending.forEach((waiter) => waiter.resolve())
      } catch (error) {
        pending.forEach((waiter) => waiter.reject(error))
        throw error
      }
    })

    return running
  }

  return {
    save(store) {
      queued = store
      const promise = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }))
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => { void flush().catch(() => undefined) }, debounceMs)
      return promise
    },
    flush,
  }
}
