/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL project Supabase, mis. https://xxxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** Anon/publishable key — aman di browser karena RLS menjaga data. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Opsional: paksa satu outlet. Kosong = outlet otomatis dari akun staf. */
  readonly VITE_OUTLET_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
