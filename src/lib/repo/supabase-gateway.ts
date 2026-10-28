import type { SupabaseClient } from '@supabase/supabase-js'

import type { SupabaseConfig } from '../supabase'
import type { RepoGateway, Row, TableName } from './gateway'

const CONFLICT_TARGET: Partial<Record<TableName, string>> = {
  app_settings: 'outlet_id',
  pos_documents: 'outlet_id,key',
}

const CHUNK_SIZE = 200

/** Implementasi tipis di atas PostgREST; tidak ada logika bisnis di sini. */
export function supabaseGateway(client: SupabaseClient): RepoGateway {
  return {
    async list(table, outlet) {
      const { data, error } = await client.from(table).select('*').eq('outlet_id', outlet)
      if (error) throw new Error(`Gagal memuat ${table}: ${error.message}`)
      return (data ?? []) as Row[]
    },
    async upsert(table, rows) {
      for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
        const chunk = rows.slice(index, index + CHUNK_SIZE)
        const { error } = await client.from(table).upsert(chunk, { onConflict: CONFLICT_TARGET[table] ?? 'id' })
        if (error) throw new Error(`Gagal menyimpan ${table}: ${error.message}`)
      }
    },
    async remove(table, outlet, ids) {
      for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
        const chunk = ids.slice(index, index + CHUNK_SIZE)
        const { error } = await client.from(table).delete().eq('outlet_id', outlet).in('id', chunk)
        if (error) throw new Error(`Gagal menghapus ${table}: ${error.message}`)
      }
    },
  }
}

/** Outlet dari env, atau baris staf milik akun yang sedang login. */
export async function resolveOutletId(client: SupabaseClient, config: SupabaseConfig): Promise<string> {
  if (config.outletId) return config.outletId
  const { data, error } = await client.from('staff').select('outlet_id').limit(1).maybeSingle()
  if (error) throw new Error(`Gagal membaca akses outlet: ${error.message}`)
  const outletId = data && typeof data === 'object' ? String((data as { outlet_id?: unknown }).outlet_id ?? '') : ''
  if (!outletId) throw new Error('OUTLET_NOT_FOUND')
  return outletId
}

/** Onboarding: buat outlet pertama + daftarkan akun sebagai pemilik. */
export async function createOutlet(client: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await client.rpc('create_outlet', { p_name: name })
  if (error) throw new Error(`Gagal membuat outlet: ${error.message}`)
  if (typeof data !== 'string' || !data) throw new Error('Outlet dibuat tetapi ID tidak dikembalikan server.')
  return data
}
