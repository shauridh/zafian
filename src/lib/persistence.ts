import { SCHEMA_VERSION, type PosStore } from '../domain/pos'
import { createBackupRecord, inspectBackup, serializeBackup } from './backup'
import { getOnlineDriver } from './online'
import { normalizeStore, type NormalizeOptions } from './schema'
import { getCachedJson, PRIMARY_STORAGE_KEY, rememberSchemaVersion, writeJson } from './storage'

const LEGACY_STORAGE_KEY = 'sabana-pos-store-v1'

export { SCHEMA_VERSION }

export function loadPosStore(options: NormalizeOptions = {}): PosStore {
  const cached = getCachedJson<unknown>(PRIMARY_STORAGE_KEY)
  if (cached !== undefined) return normalizeStore(cached, options)
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
      if (raw) return normalizeStore(JSON.parse(raw) as unknown, options)
    } catch (error) {
      console.error('State localStorage tidak bisa dibaca', error)
    }
  }
  return normalizeStore({}, options)
}

export async function savePosStore(store: PosStore): Promise<void> {
  const online = getOnlineDriver()
  // Mode online: outlet kosong harus tetap kosong. Seed katalog contoh hanya
  // untuk mode lokal; bila dipaksa di online, ID slug (mis. "paket") akan
  // dikirim ke kolom uuid dan ditolak Supabase dengan 22P02.
  const normalized = normalizeStore(store, { seed: !online })
  if (online) {
    // Sumber kebenaran = Supabase; IndexedDB tidak ditulis saat mode online.
    await online.save(normalized)
    return
  }
  await writeJson(PRIMARY_STORAGE_KEY, normalized)
  rememberSchemaVersion(SCHEMA_VERSION)
}

/** Backup JSON lengkap: format, versi skema, timestamp, ringkasan, dan state. */
export function exportStore(store: PosStore): string {
  return serializeBackup(createBackupRecord(store, 'manual'))
}

/** Kembalikan null untuk file rusak; pemanggil UI memakai inspectBackup untuk pesan detail. */
export function parseStoreBackup(raw: string): PosStore | null {
  const inspected = inspectBackup(raw)
  return inspected.ok ? inspected.store : null
}
