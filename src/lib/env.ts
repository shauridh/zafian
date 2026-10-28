/**
 * Nilai build-time untuk mem-prefill konfigurasi Supabase.
 *
 * Hanya URL project, anon/publishable key, dan UUID outlet yang boleh dibaca
 * dari environment. Password owner, frasa sandi enkripsi, dan service role key
 * tidak pernah masuk ke sini.
 *
 * Nilai ini hanyalah default form: konfigurasi yang sudah disimpan pengguna
 * selalu menang, dan aktivasi tetap memerlukan login + frasa sandi di UI.
 */

export type SupabaseEnv = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  VITE_OUTLET_ID?: string
}

export type SupabaseDefaults = {
  projectUrl: string
  anonKey: string
  outletId: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readBuildEnv(): SupabaseEnv {
  try {
    // Akses properti langsung agar Vite mengganti nilainya saat build.
    return {
      VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
      VITE_OUTLET_ID: import.meta.env.VITE_OUTLET_ID,
    }
  } catch {
    // Bun/jsdom tidak menyediakan import.meta.env; aplikasi tetap berjalan tanpa prefill.
    return {}
  }
}

/** Kembalikan default hanya bila minimal satu variabel berisi. */
export function supabaseEnvDefaults(env: SupabaseEnv = readBuildEnv()): SupabaseDefaults | null {
  const defaults: SupabaseDefaults = {
    projectUrl: text(env.VITE_SUPABASE_URL),
    anonKey: text(env.VITE_SUPABASE_ANON_KEY),
    outletId: text(env.VITE_OUTLET_ID),
  }
  return defaults.projectUrl || defaults.anonKey || defaults.outletId ? defaults : null
}

/**
 * Nilai tersimpan pengguna menang; environment hanya mengisi field yang belum
 * punya nilai. Tidak ada nilai yang ditulis otomatis ke penyimpanan.
 */
export function mergeSupabaseDefaults(
  env: SupabaseDefaults | null,
  stored?: Partial<SupabaseDefaults> | null,
): SupabaseDefaults {
  return {
    projectUrl: text(stored?.projectUrl) || env?.projectUrl || '',
    anonKey: text(stored?.anonKey) || env?.anonKey || '',
    outletId: text(stored?.outletId) || env?.outletId || '',
  }
}
