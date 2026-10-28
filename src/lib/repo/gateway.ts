/**
 * Gateway tipis ke database. Antarmuka ini sengaja kecil supaya lapisan repo
 * bisa diuji tanpa project Supabase nyata (lihat scripts/repo-check.ts).
 */
export type Row = Record<string, unknown>

export type TableName =
  | 'app_settings'
  | 'menu_categories'
  | 'ingredient_categories'
  | 'menu_items'
  | 'ingredients'
  | 'stock_movements'
  | 'shifts'
  | 'transactions'
  | 'pos_documents'

export interface RepoGateway {
  list(table: TableName, outletId: string): Promise<Row[]>
  upsert(table: TableName, rows: Row[]): Promise<void>
  remove(table: TableName, outletId: string, ids: string[]): Promise<void>
}
