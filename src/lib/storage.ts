/**
 * Small JSON key/value storage.
 *
 * IndexedDB is the primary backend. The localStorage path is kept only as a
 * compatibility fallback for old browsers/WebViews and for the jsdom runtime
 * check; every save still goes through this module so failures are observable.
 */

export type StorageBackend = 'indexeddb' | 'localstorage' | 'memory'

export type StorageInit = {
  backend: StorageBackend
  migrated: boolean
  warning?: string
}

const DB_NAME = 'sabana-pos'
const DB_VERSION = 1
const OBJECT_STORE = 'kv'
const PRIMARY_KEY = 'pos-store'
const LEGACY_STORE_KEY = 'sabana-pos-store-v1'
const LEGACY_VERSION_KEY = 'sabana-pos-schema-version'
const MIGRATION_KEY = 'meta:legacy-migration'
export const BACKUP_STORAGE_KEY = 'backup:latest'
export const MIGRATION_STORAGE_KEY = MIGRATION_KEY
export const PRIMARY_STORAGE_KEY = PRIMARY_KEY

const memory = new Map<string, unknown>()
let database: IDBDatabase | null = null
let initPromise: Promise<StorageInit> | null = null
let initResult: StorageInit | null = null
let backend: StorageBackend = typeof indexedDB === 'undefined'
  ? (typeof localStorage === 'undefined' ? 'memory' : 'localstorage')
  : 'indexeddb'
let writeChain: Promise<void> = Promise.resolve()

function localStorageRef(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch (error) {
    console.warn('localStorage tidak dapat diakses', error)
    return null
  }
}

function localKey(key: string): string {
  if (key === PRIMARY_KEY) return LEGACY_STORE_KEY
  if (key === BACKUP_STORAGE_KEY) return 'sabana-pos-backup-latest'
  return `sabana-pos:${key}`
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB gagal dibuka'))
    request.onblocked = () => reject(new Error('IndexedDB diblokir oleh tab lain'))
  })
}

function idbRead<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    if (!database) { reject(new Error('IndexedDB belum siap')); return }
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(OBJECT_STORE, 'readonly')
    } catch (error) {
      reject(error)
      return
    }
    const request = transaction.objectStore(OBJECT_STORE).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error ?? new Error('Gagal membaca IndexedDB'))
  })
}

function idbWrite(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!database) { reject(new Error('IndexedDB belum siap')); return }
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(OBJECT_STORE, 'readwrite')
    } catch (error) {
      reject(error)
      return
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Gagal menulis IndexedDB'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Penulisan IndexedDB dibatalkan'))
    try {
      transaction.objectStore(OBJECT_STORE).put(value, key)
    } catch (error) {
      reject(error)
    }
  })
}

function parseLegacy(raw: string): unknown {
  return JSON.parse(raw) as unknown
}

/**
 * Membuka storage dan memigrasikan state localStorage lama satu kali.
 * Data lama tidak dihapus. Bila IndexedDB sudah punya state, migrasi dilewati
 * sehingga data pengguna yang lebih baru tidak tertimpa.
 */
export function initStorage(): Promise<StorageInit> {
  if (initPromise) return initPromise
  initPromise = (async (): Promise<StorageInit> => {
    if (typeof indexedDB === 'undefined') {
      backend = localStorageRef() ? 'localstorage' : 'memory'
      const warning = backend === 'localstorage'
        ? 'IndexedDB tidak tersedia di runtime ini; data disimpan di localStorage. Backup manual tetap disarankan.'
        : 'Penyimpanan browser tidak tersedia; data hanya bertahan selama aplikasi terbuka.'
      initResult = { backend, migrated: false, warning }
      return initResult
    }

    try {
      database = await openDatabase()
      backend = 'indexeddb'
      const existing = await idbRead<unknown>(PRIMARY_KEY)
      if (existing !== undefined) {
        memory.set(PRIMARY_KEY, existing)
        initResult = { backend, migrated: false }
        return initResult
      }

      const legacy = localStorageRef()?.getItem(LEGACY_STORE_KEY)
      if (!legacy) {
        initResult = { backend, migrated: false }
        return initResult
      }

      let parsed: unknown
      try {
        parsed = parseLegacy(legacy)
      } catch (error) {
        console.error('State localStorage lama tidak bisa dibaca', error)
        initResult = {
          backend,
          migrated: false,
          warning: 'State lama di localStorage tidak bisa dibaca. Data lama tidak dihapus; aplikasi memakai katalog baru.',
        }
        return initResult
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        initResult = {
          backend,
          migrated: false,
          warning: 'State lama di localStorage bukan objek yang valid. Data lama tidak dihapus.',
        }
        return initResult
      }

      await idbWrite(PRIMARY_KEY, parsed)
      await idbWrite(MIGRATION_KEY, {
        migratedAt: new Date().toISOString(),
        source: LEGACY_STORE_KEY,
        target: PRIMARY_KEY,
      })
      memory.set(PRIMARY_KEY, parsed)
      initResult = { backend, migrated: true }
      return initResult
    } catch (error) {
      console.error('IndexedDB gagal disiapkan; memakai localStorage', error)
      backend = localStorageRef() ? 'localstorage' : 'memory'
      const legacy = localStorageRef()?.getItem(LEGACY_STORE_KEY)
      if (legacy) {
        try { memory.set(PRIMARY_KEY, parseLegacy(legacy)) } catch (parseError) {
          console.error('State localStorage lama tidak bisa dibaca saat fallback', parseError)
        }
      }
      initResult = {
        backend,
        migrated: false,
        warning: backend === 'localstorage'
          ? 'IndexedDB tidak dapat dibuka; data sementara disimpan di localStorage. Segera unduh backup.'
          : 'Penyimpanan tidak tersedia; data hanya bertahan selama aplikasi terbuka.',
      }
      return initResult
    }
  })()
  return initPromise
}

export function isStorageReady(): boolean {
  return initResult !== null
}

export function getStorageBackend(): StorageBackend {
  return backend
}

export function getStorageWarning(): string | undefined {
  return initResult?.warning
}

/** Dipakai load awal; cache sudah diisi oleh initStorage atau writeJson. */
export function getCachedJson<T>(key: string): T | undefined {
  return memory.has(key) ? memory.get(key) as T : undefined
}

/**
 * Isi cache memori tanpa menulis ke backend. Dipakai mode online: data berasal
 * dari Supabase dan IndexedDB tidak menjadi sumber kebenaran.
 */
export function primeStorageCache(key: string, value: unknown): void {
  memory.set(key, value)
}

export async function readJson<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T
  if (backend === 'indexeddb') {
    const value = await idbRead<T>(key)
    if (value !== undefined) memory.set(key, value)
    return value
  }
  const storage = localStorageRef()
  if (!storage) return undefined
  const raw = storage.getItem(localKey(key))
  if (raw === null) return undefined
  const parsed = JSON.parse(raw) as T
  memory.set(key, parsed)
  return parsed
}

function writeNow(key: string, value: unknown): Promise<void> {
  if (backend === 'indexeddb') return idbWrite(key, value)
  if (backend === 'localstorage') {
    const storage = localStorageRef()
    if (!storage) return Promise.reject(new Error('localStorage tidak tersedia'))
    try {
      storage.setItem(localKey(key), JSON.stringify(value))
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(error)
    }
  }
  return Promise.reject(new Error('Tidak ada penyimpanan persisten yang tersedia'))
}

/**
 * Tulis JSON ke backend aktif. Cache diperbarui segera, tetapi promise tetap
 * ditolak bila backend gagal agar UI bisa menampilkan error yang terlihat.
 */
export function writeJson(key: string, value: unknown): Promise<void> {
  memory.set(key, value)
  if (backend === 'localstorage') {
    // Fallback tetap sinkron agar perubahan langsung tersedia untuk pembacaan berikutnya.
    return writeNow(key, value)
  }
  const run = () => writeNow(key, value)
  const next = writeChain.then(run, run)
  writeChain = next.catch((error) => {
    console.error(`Gagal menulis storage untuk key ${key}`, error)
  })
  return next
}

/** Simpan versi skema lama untuk kompatibilitas tooling/backup lama. */
export function rememberSchemaVersion(version: number): void {
  try {
    localStorageRef()?.setItem(LEGACY_VERSION_KEY, String(version))
  } catch (error) {
    console.warn('Versi skema tidak bisa ditulis ke localStorage', error)
  }
}

export function describeStorageError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'QuotaExceededError' || /quota|penuh|full/i.test(message)) {
    return 'Penyimpanan perangkat penuh. Hapus foto menu lama atau unduh backup lalu pindahkan data.'
  }
  if (/indexeddb belum siap/i.test(message)) return 'Penyimpanan belum siap. Muat ulang aplikasi lalu coba lagi.'
  return message || 'Penyimpanan gagal tanpa pesan dari browser.'
}

/** Hanya untuk pengujian; aplikasi tidak memanggil fungsi ini. */
export async function resetStorageForTests(): Promise<void> {
  database?.close()
  database = null
  memory.clear()
  initPromise = null
  initResult = null
  writeChain = Promise.resolve()
  backend = typeof indexedDB === 'undefined'
    ? (typeof localStorage === 'undefined' ? 'memory' : 'localstorage')
    : 'indexeddb'
}
