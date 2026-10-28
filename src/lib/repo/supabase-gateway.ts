import type { SupabaseClient } from '@supabase/supabase-js'

import type { RepoGateway, Row, TableName } from './gateway'

const CONFLICT_TARGET: Partial<Record<TableName, string>> = {
  app_settings: 'outlet_id',
  pos_documents: 'outlet_id,key',
}

const CHUNK_SIZE = 200

/**
 * Postgres menolak penulisan dengan `42501`/row-level security bila akun bukan
 * pemilik outlet. Pesan mentahnya membingungkan, jadi diterjemahkan menjadi
 * langkah perbaikan yang bisa dilakukan pengguna.
 */
export function describeRepoError(action: 'memuat' | 'menyimpan' | 'menghapus', table: TableName, message: string): Error {
  if (/row-level security|permission denied|42501/i.test(message)) {
    return new Error(
      `Gagal ${action} ${table}: akses ditolak oleh kebijakan RLS Supabase. `
      + 'Akun yang login harus terdaftar sebagai owner outlet ini — lihat bagian "Akses ditolak (RLS)" di supabase/README.md. '
      + `(${message})`,
    )
  }
  return new Error(`Gagal ${action} ${table}: ${message}`)
}

/** Implementasi tipis di atas PostgREST; tidak ada logika bisnis di sini. */
export function supabaseGateway(client: SupabaseClient): RepoGateway {
  return {
    async list(table, outlet) {
      const { data, error } = await client.from(table).select('*').eq('outlet_id', outlet)
      if (error) throw describeRepoError('memuat', table, error.message)
      return (data ?? []) as Row[]
    },
    async upsert(table, rows) {
      for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
        const chunk = rows.slice(index, index + CHUNK_SIZE)
        const { error } = await client.from(table).upsert(chunk, { onConflict: CONFLICT_TARGET[table] ?? 'id' })
        if (error) throw describeRepoError('menyimpan', table, error.message)
      }
    },
    async remove(table, outlet, ids) {
      for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
        const chunk = ids.slice(index, index + CHUNK_SIZE)
        const { error } = await client.from(table).delete().eq('outlet_id', outlet).in('id', chunk)
        if (error) throw describeRepoError('menghapus', table, error.message)
      }
    },
  }
}

export type OutletAccess = {
  outletId: string
  role: 'owner' | 'cashier'
}

/**
 * Akses outlet milik akun yang sedang login. RLS `staff` hanya mengembalikan
 * baris milik sendiri, jadi hasilnya selalu outlet yang boleh dipakai akun ini.
 * Mengembalikan null bila akun belum punya baris staf (login pertama).
 */
export async function readOutletAccess(client: SupabaseClient): Promise<OutletAccess | null> {
  const { data, error } = await client.from('staff').select('outlet_id, role').limit(1).maybeSingle()
  if (error) throw new Error(`Gagal membaca akses outlet: ${error.message}`)
  if (!data || typeof data !== 'object') return null
  const row = data as { outlet_id?: unknown; role?: unknown }
  const outletId = typeof row.outlet_id === 'string' ? row.outlet_id.trim() : ''
  if (!outletId) return null
  return { outletId, role: row.role === 'cashier' ? 'cashier' : 'owner' }
}

/** Pembuatan outlet otomatis untuk akun pemilik (tanpa layar onboarding). */
export async function createOutlet(client: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await client.rpc('create_outlet', { p_name: name })
  if (error) throw new Error(`Gagal membuat outlet: ${error.message}`)
  if (typeof data !== 'string' || !data) throw new Error('Outlet dibuat tetapi ID tidak dikembalikan server.')
  return data
}
