/**
 * Metadata sinkronisasi lokal (Fase 0).
 *
 * Nilai ini bukan state bisnis dan tidak ditampilkan di UI. Tujuannya memberi
 * identitas stabil untuk outlet/perangkat serta versi baris saat data lokal
 * diekspor ke staging Supabase. Placeholder deterministik dipakai pada migrasi
 * pertama agar normalisasi tetap idempoten; exporter menerima override
 * `--outlet-id`/`--device-id` saat outlet nyata sudah dibuat di Supabase.
 */

export type SyncMeta = {
  outletId: string
  deviceId: string
  /** Versi baris state; dinaikkan oleh outbox pada fase push. */
  revision: number
  /** Waktu bisnis terakhir yang bisa diturunkan dari data lokal. */
  updatedAt: string
}

export const LOCAL_OUTLET_ID = 'outlet-local'
export const LOCAL_DEVICE_ID = 'device-local'
export const SYNC_FALLBACK_TIME = '1970-01-01T00:00:00.000Z'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const validTime = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** Timestamp valid paling akhir; fallback epoch agar hasil deterministik. */
export function latestBusinessTimestamp(values: readonly (string | undefined)[]): string {
  let latest = ''
  let latestTime = -Infinity
  for (const value of values) {
    const time = validTime(value)
    if (time === null || time <= latestTime) continue
    latestTime = time
    latest = value as string
  }
  return latest || SYNC_FALLBACK_TIME
}

export function createSyncMeta(overrides: Partial<SyncMeta> = {}): SyncMeta {
  return {
    outletId: overrides.outletId?.trim() || LOCAL_OUTLET_ID,
    deviceId: overrides.deviceId?.trim() || LOCAL_DEVICE_ID,
    revision: Math.max(1, Math.trunc(overrides.revision ?? 1)),
    updatedAt: latestBusinessTimestamp([overrides.updatedAt]),
  }
}

/**
 * Normalisasi idempoten. `updatedAt` tidak pernah bergerak mundur dan naik
 * otomatis mengikuti timestamp bisnis terbaru, sehingga state lama tetap sah
 * tanpa mengubah riwayat.
 */
export function normalizeSyncMeta(value: unknown, latestBusinessAt: string): SyncMeta {
  const raw = isRecord(value) ? value : {}
  const revision = typeof raw.revision === 'number' && Number.isFinite(raw.revision) ? Math.max(1, Math.trunc(raw.revision)) : 1
  const updatedAt = latestBusinessTimestamp([
    typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    validTime(latestBusinessAt) !== null ? latestBusinessAt : undefined,
  ])
  return {
    outletId: typeof raw.outletId === 'string' && raw.outletId.trim() ? raw.outletId.trim() : LOCAL_OUTLET_ID,
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId.trim() ? raw.deviceId.trim() : LOCAL_DEVICE_ID,
    revision,
    updatedAt,
  }
}
