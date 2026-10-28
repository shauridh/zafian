import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Konfigurasi Supabase dibaca dari env build-time Vite. Tanpa dua nilai wajib
 * (URL + anon key) aplikasi berjalan dalam mode lokal untuk pengembangan dan
 * pemeriksaan UI; build produksi wajib mengisi env di dashboard Vercel.
 */
export type SupabaseConfig = {
  url: string
  anonKey: string
  /** Opsional; bila kosong outlet diambil dari baris `staff` milik akun. */
  outletId: string
}

export type SupabaseEnv = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  VITE_OUTLET_ID?: string
}

export function readSupabaseConfig(env: SupabaseEnv = import.meta.env as SupabaseEnv): SupabaseConfig | null {
  const url = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  if (!url && !anonKey) return null
  if (!url || !anonKey) {
    throw new Error('Konfigurasi Supabase tidak lengkap: isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY lalu build ulang.')
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('VITE_SUPABASE_URL harus berupa URL lengkap, mis. https://xxxx.supabase.co')
  }
  return { url, anonKey, outletId: (env.VITE_OUTLET_ID ?? '').trim() }
}

let cached: { url: string; anonKey: string; client: SupabaseClient } | null = null

/** Satu instance client per URL/key; sesi disimpan oleh supabase-js. */
export function supabaseClient(config: SupabaseConfig): SupabaseClient {
  if (cached && cached.url === config.url && cached.anonKey === config.anonKey) return cached.client
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  cached = { url: config.url, anonKey: config.anonKey, client }
  return client
}

/** Hanya untuk pemeriksaan/test yang perlu memaksa client baru. */
export function resetSupabaseClientForTests(): void {
  cached = null
}
