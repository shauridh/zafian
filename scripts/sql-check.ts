/**
 * check:sql — menjalankan SEMUA migration Supabase pada Postgres nyata (PGlite,
 * Postgres 18 versi WASM) dengan stub Supabase, lalu menguji setiap write path
 * yang dipakai aplikasi terhadap policy RLS-nya.
 *
 * Kenapa ada: check:repo memakai gateway tiruan, jadi policy tabel tidak pernah
 * diuji. Bug `transaction_items` (trigger insert ditolak RLS) hanya ketahuan di
 * produksi. Skrip ini menutup celah itu: migrasi dijalankan berurutan, lalu
 * setiap tabel ditulis sebagai owner outlet, ditolak untuk akun outlet lain,
 * dan alur checkout penuh (shift → transaksi → baris item) dijalankan.
 *
 * Jalankan: `bun run check:sql`
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { PGlite } from '@electric-sql/pglite'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const MIGRATIONS = resolve(ROOT, 'supabase/migrations')

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail: unknown = ''): void {
  if (ok) passed += 1
  else {
    failed += 1
    failures.push(name)
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` :: ${detail}`}`)
}

const db = new PGlite()

const message = (error: unknown): string => (error instanceof Error ? error.message.split('\n')[0] : String(error))

const expectError = async (sql: string): Promise<string> => {
  try {
    await db.exec(sql)
    return ''
  } catch (error) {
    return message(error)
  }
}

const scalar = async (sql: string): Promise<number> => {
  const result = await db.query<{ value: number }>(sql)
  return Number(result.rows[0]?.value ?? -1)
}

const text = async (sql: string): Promise<string> => {
  const result = await db.query<{ value: string | null }>(sql)
  return result.rows[0]?.value ?? ''
}

const asUser = async (userId: string, email: string): Promise<void> => {
  await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, email })}', false); set role authenticated;`)
}
const asAnon = async (): Promise<void> => {
  await db.exec(`select set_config('request.jwt.claims', '{}', false); set role anon;`)
}
const asAdmin = async (): Promise<void> => { await db.exec('reset role;') }

/* -------------------------------------------------------------------------- */
/* Stub Supabase (role + schema auth) — hanya untuk pengujian                 */
/* -------------------------------------------------------------------------- */

await db.exec(`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
`)

const migrationFiles = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort()
for (const file of migrationFiles) {
  await db.exec(readFileSync(resolve(MIGRATIONS, file), 'utf8'))
}
console.log(`— ${migrationFiles.length} migration diterapkan: ${migrationFiles.join(', ')} —`)
check('semua migration apply bersih pada database kosong', migrationFiles.length >= 3, String(migrationFiles.length))
check('12 tabel aplikasi terbentuk', (await scalar("select count(*)::int as value from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")) === 12)

/* -------------------------------------------------------------------------- */
/* 1. Onboarding: create_outlet untuk dua akun terpisah                       */
/* -------------------------------------------------------------------------- */

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'pemilik@uji.test'), ('${OTHER}', 'lain@uji.test');`)

await asUser(OWNER, 'pemilik@uji.test')
const outletA = await text("select public.create_outlet('Outlet A') as value")
check('create_outlet mengembalikan uuid outlet', /^[0-9a-f-]{36}$/i.test(outletA), outletA)
check('login pertama mendaftarkan akun sebagai owner', (await text(`select role as value from public.staff where user_id = '${OWNER}'`)) === 'owner')
check('login pertama membuat app_settings', (await scalar(`select count(*)::int as value from public.app_settings where outlet_id = '${outletA}'`)) === 1)
const outletAAgain = await text("select public.create_outlet('Outlet A') as value")
check('create_outlet idempoten (tidak membuat outlet ganda)', outletAAgain === outletA, `${outletAAgain}/${outletA}`)
await asAdmin()

await asUser(OTHER, 'lain@uji.test')
const outletB = await text("select public.create_outlet('Outlet B') as value")
check('akun kedua mendapat outlet sendiri', /^[0-9a-f-]{36}$/i.test(outletB) && outletB !== outletA, outletB)
await asAdmin()

/* -------------------------------------------------------------------------- */
/* 2. Owner menulis setiap tabel yang dipakai aplikasi (insert + update)      */
/* -------------------------------------------------------------------------- */

const category = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const ingredientCategory = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
const menu = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'
const ingredient = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4'
const movement = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5'
const shift = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc6'
const transaction = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc7'

await asUser(OWNER, 'pemilik@uji.test')

const ownerWrites: { name: string; sql: string }[] = [
  {
    name: 'app_settings upsert',
    sql: `insert into public.app_settings (outlet_id, data) values ('${outletA}', '{"businessName":"Warung Uji"}')
          on conflict (outlet_id) do update set data = excluded.data`,
  },
  {
    name: 'menu_categories insert',
    sql: `insert into public.menu_categories (id, outlet_id, name) values ('${category}', '${outletA}', 'Paket')`,
  },
  {
    name: 'ingredient_categories insert',
    sql: `insert into public.ingredient_categories (id, outlet_id, name) values ('${ingredientCategory}', '${outletA}', 'Protein')`,
  },
  {
    name: 'menu_items insert',
    sql: `insert into public.menu_items (id, outlet_id, name, category, price, emoji, recipe)
          values ('${menu}', '${outletA}', 'Ayam Dada', 'Paket', 16000, '🍗', '[]'::jsonb)`,
  },
  {
    name: 'ingredients insert',
    sql: `insert into public.ingredients (id, outlet_id, name, category, unit, cost_per_unit, purchase_unit, purchase_price, usage_per_purchase_unit, min_stock)
          values ('${ingredient}', '${outletA}', 'Ayam', 'Protein', 'potong', 6000, 'ekor', 48000, 9, 18)`,
  },
  {
    name: 'stock_movements insert',
    sql: `insert into public.stock_movements (id, outlet_id, ingredient_id, type, qty, total_cost, note)
          values ('${movement}', '${outletA}', '${ingredient}', 'purchase', 9, 48000, 'Belanja')`,
  },
  {
    name: 'shifts insert (buka shift)',
    sql: `insert into public.shifts (id, outlet_id, opened_at, opening_float, status)
          values ('${shift}', '${outletA}', now(), 350000, 'open')`,
  },
  {
    name: 'transactions insert (checkout) + trigger transaction_items',
    sql: `insert into public.transactions (id, outlet_id, shift_id, number, created_at, order_type, payment_method, items, subtotal, paid_amount, change_due)
          values ('${transaction}', '${outletA}', '${shift}', 'POS-1', now(), 'Takeaway', 'Cash',
            '[{"id":"${menu}","name":"Ayam Dada","category":"Paket","price":16000,"qty":2,"emoji":"🍗"},{"id":"teh","name":"Es Teh","category":"Minuman","price":4000,"qty":1}]'::jsonb, 36000, 50000, 14000)`,
  },
  {
    name: 'pos_documents insert/upsert',
    sql: `insert into public.pos_documents (outlet_id, key, data) values ('${outletA}', 'cash_movements', '[]'::jsonb)
          on conflict (outlet_id, key) do update set data = excluded.data`,
  },
]

for (const write of ownerWrites) {
  check(`owner: ${write.name}`, (await expectError(write.sql)) === '')
}

const ownerUpdates: { name: string; sql: string }[] = [
  { name: 'menu_categories update', sql: `update public.menu_categories set name = 'Paket Hemat' where id = '${category}'` },
  { name: 'ingredient_categories update', sql: `update public.ingredient_categories set name = 'Protein Ayam' where id = '${ingredientCategory}'` },
  { name: 'menu_items update', sql: `update public.menu_items set price = 17000 where id = '${menu}'` },
  { name: 'ingredients update', sql: `update public.ingredients set min_stock = 20 where id = '${ingredient}'` },
  { name: 'stock_movements update', sql: `update public.stock_movements set note = 'Belanja pagi' where id = '${movement}'` },
  { name: 'shifts update (tutup shift)', sql: `update public.shifts set status = 'closed', closed_at = now(), actual_cash = 400000 where id = '${shift}'` },
  { name: 'transactions update (void)', sql: `update public.transactions set status = 'cancelled', status_reason = 'uji' where id = '${transaction}'` },
  { name: 'app_settings update', sql: `update public.app_settings set data = '{"businessName":"Warung Uji 2"}' where outlet_id = '${outletA}'` },
  { name: 'pos_documents update', sql: `update public.pos_documents set data = '[{"id":"kas-1"}]'::jsonb where outlet_id = '${outletA}' and key = 'cash_movements'` },
]

await asAdmin()
for (const update of ownerUpdates) {
  await asUser(OWNER, 'pemilik@uji.test')
  check(`owner: ${update.name}`, (await expectError(update.sql)) === '')
  await asAdmin()
}

check('checkout tersimpan utuh (total & kembalian)', (await scalar(`select count(*)::int as value from public.transactions where id = '${transaction}' and subtotal = 36000 and paid_amount = 50000 and change_due = 14000`)) === 1)
check('trigger mengisi 2 baris transaction_items', (await scalar(`select count(*)::int as value from public.transaction_items where transaction_id = '${transaction}'`)) === 2)
check('baris item menyimpan menu, qty, dan harga', (await scalar(`select count(*)::int as value from public.transaction_items where transaction_id = '${transaction}' and menu_id = '${menu}' and qty = 2 and price = 16000`)) === 1)
check('trigger berjalan sebagai security definer', (await db.query<{ value: boolean }>("select p.prosecdef as value from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'sync_transaction_items'")).rows[0]?.value === true)

/* Update item transaksi harus menulis ulang baris item. */
await asUser(OWNER, 'pemilik@uji.test')
await expectError(`update public.transactions set items = '[{"id":"${menu}","name":"Ayam Dada","category":"Paket","price":16000,"qty":1,"emoji":"🍗"}]'::jsonb where id = '${transaction}'`)
await asAdmin()
check('update transaksi menulis ulang transaction_items', (await scalar(`select count(*)::int as value from public.transaction_items where transaction_id = '${transaction}'`)) === 1)
check('qty baris item ikut berubah', (await scalar(`select count(*)::int as value from public.transaction_items where transaction_id = '${transaction}' and qty = 1`)) === 1)

/* -------------------------------------------------------------------------- */
/* 3. Hapus (restore/hapus data) untuk setiap tabel yang dihapus aplikasi     */
/* -------------------------------------------------------------------------- */

const trash = {
  category: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  ingredientCategory: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
  menu: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
  ingredient: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
  movement: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5',
  shift: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd6',
  transaction: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd7',
}

await asUser(OWNER, 'pemilik@uji.test')
const trashWrites = [
  `insert into public.menu_categories (id, outlet_id, name) values ('${trash.category}', '${outletA}', 'Hapus')`,
  `insert into public.ingredient_categories (id, outlet_id, name) values ('${trash.ingredientCategory}', '${outletA}', 'Hapus')`,
  `insert into public.menu_items (id, outlet_id, name, category, price) values ('${trash.menu}', '${outletA}', 'Hapus', 'Lainnya', 1000)`,
  `insert into public.ingredients (id, outlet_id, name, unit) values ('${trash.ingredient}', '${outletA}', 'Hapus', 'pcs')`,
  `insert into public.stock_movements (id, outlet_id, ingredient_id, type, qty) values ('${trash.movement}', '${outletA}', '${trash.ingredient}', 'adjustment', 1)`,
  `insert into public.shifts (id, outlet_id, opened_at, status) values ('${trash.shift}', '${outletA}', now(), 'open')`,
  `insert into public.transactions (id, outlet_id, number, created_at, order_type, payment_method, items) values ('${trash.transaction}', '${outletA}', 'POS-9', now(), 'Takeaway', 'Cash', '[{"id":"x","name":"X","category":"Y","price":1,"qty":1}]'::jsonb)`,
]
for (const statement of trashWrites) await expectError(statement)

const deletes: { table: string; name: string; id: string }[] = [
  { table: 'menu_categories', name: 'hapus kategori menu', id: trash.category },
  { table: 'ingredient_categories', name: 'hapus kategori bahan', id: trash.ingredientCategory },
  { table: 'menu_items', name: 'hapus menu', id: trash.menu },
  { table: 'stock_movements', name: 'hapus pergerakan stok', id: trash.movement },
  { table: 'ingredients', name: 'hapus bahan', id: trash.ingredient },
  { table: 'transactions', name: 'hapus transaksi (restore)', id: trash.transaction },
  { table: 'shifts', name: 'hapus shift (restore)', id: trash.shift },
]

for (const item of deletes) {
  await asUser(OWNER, 'pemilik@uji.test')
  const error = await expectError(`delete from public.${item.table} where id = '${item.id}'`)
  await asAdmin()
  const remaining = await scalar(`select count(*)::int as value from public.${item.table} where id = '${item.id}'`)
  check(`owner: ${item.name} benar-benar menghapus baris`, error === '' && remaining === 0, error || `sisa ${remaining}`)
}

check('baris item transaksi ikut terhapus saat transaksi dihapus', (await scalar(`select count(*)::int as value from public.transaction_items where transaction_id = '${trash.transaction}'`)) === 0)

/* -------------------------------------------------------------------------- */
/* 4. Isolasi antar-outlet: akun outlet B tidak boleh menyentuh data outlet A */
/* -------------------------------------------------------------------------- */

const foreignInserts: { name: string; table: string; sql: string }[] = [
  { name: 'menu_categories', table: 'menu_categories', sql: `insert into public.menu_categories (outlet_id, name) values ('${outletA}', 'Bocor')` },
  { name: 'ingredient_categories', table: 'ingredient_categories', sql: `insert into public.ingredient_categories (outlet_id, name) values ('${outletA}', 'Bocor')` },
  { name: 'menu_items', table: 'menu_items', sql: `insert into public.menu_items (outlet_id, name) values ('${outletA}', 'Bocor')` },
  { name: 'ingredients', table: 'ingredients', sql: `insert into public.ingredients (outlet_id, name) values ('${outletA}', 'Bocor')` },
  { name: 'stock_movements', table: 'stock_movements', sql: `insert into public.stock_movements (outlet_id, ingredient_id, type, qty) values ('${outletA}', '${ingredient}', 'adjustment', 1)` },
  { name: 'shifts', table: 'shifts', sql: `insert into public.shifts (outlet_id, opened_at) values ('${outletA}', now())` },
  { name: 'transactions', table: 'transactions', sql: `insert into public.transactions (outlet_id, number, created_at, order_type, payment_method) values ('${outletA}', 'POS-X', now(), 'Takeaway', 'Cash')` },
]

for (const insert of foreignInserts) {
  await asUser(OTHER, 'lain@uji.test')
  const error = await expectError(insert.sql)
  await asAdmin()
  const label = insert.table === 'app_settings' ? 'mengubah pengaturan' : 'insert'
  check(`outlet lain DITOLAK ${label} ${insert.table}`, /row-level security|permission denied/i.test(error), error || 'tidak ada error (bocor)')
}

/* app_settings hanya punya satu baris per outlet: uji UPDATE lintas outlet. */
await asUser(OTHER, 'lain@uji.test')
const appError = await expectError(`update public.app_settings set data = '{"bocor":true}'::jsonb where outlet_id = '${outletA}'`)
await asAdmin()
check('outlet lain DITOLAK mengubah pengaturan app_settings', (await scalar(`select count(*)::int as value from public.app_settings where outlet_id = '${outletA}' and data ->> 'bocor' is not null`)) === 0, appError || 'data berubah')

/* Update & delete lintas outlet harus tidak mengubah apa pun (RLS menyaring). */
await asUser(OTHER, 'lain@uji.test')
await expectError(`update public.menu_items set price = 1 where id = '${menu}'`)
await expectError(`delete from public.menu_items where id = '${menu}'`)
await expectError(`update public.shifts set status = 'closed' where id = '${shift}'`)
await expectError(`delete from public.shifts where id = '${shift}'`)
await asAdmin()
check('menu outlet A tidak berubah oleh akun outlet B', (await scalar(`select count(*)::int as value from public.menu_items where id = '${menu}' and price = 17000`)) === 1)
check('shift outlet A tidak berubah oleh akun outlet B', (await scalar(`select count(*)::int as value from public.shifts where id = '${shift}' and status = 'closed'`)) === 1)

/* -------------------------------------------------------------------------- */
/* 5. Anon tidak punya akses tabel sama sekali                                */
/* -------------------------------------------------------------------------- */

await asAnon()
const anonRead = await expectError('select * from public.menu_items limit 1')
const anonWrite = await expectError(`insert into public.menu_categories (outlet_id, name) values ('${outletA}', 'Anon')`)
await asAdmin()
check('anon ditolak membaca tabel', /permission denied|row-level security/i.test(anonRead), anonRead)
check('anon ditolak menulis tabel', /permission denied|row-level security/i.test(anonWrite), anonWrite)

/* -------------------------------------------------------------------------- */
/* 6. Policy yang dibutuhkan write path benar-benar ada                       */
/* -------------------------------------------------------------------------- */

const policies = await db.query<{ tablename: string; cmd: string }>(
  "select tablename, cmd from pg_policies where schemaname = 'public'",
)
const hasPolicy = (table: string, cmd: string) => policies.rows.some((row) => row.tablename === table && row.cmd === cmd)
for (const [table, cmd] of [
  ['menu_categories', 'INSERT'], ['menu_categories', 'UPDATE'], ['menu_categories', 'DELETE'],
  ['menu_items', 'INSERT'], ['menu_items', 'UPDATE'], ['menu_items', 'DELETE'],
  ['ingredients', 'INSERT'], ['ingredients', 'UPDATE'], ['ingredients', 'DELETE'],
  ['stock_movements', 'INSERT'], ['stock_movements', 'UPDATE'], ['stock_movements', 'DELETE'],
  ['shifts', 'INSERT'], ['shifts', 'UPDATE'], ['shifts', 'DELETE'],
  ['transactions', 'INSERT'], ['transactions', 'UPDATE'], ['transactions', 'DELETE'],
  ['transaction_items', 'INSERT'], ['transaction_items', 'DELETE'],
  ['pos_documents', 'INSERT'], ['pos_documents', 'UPDATE'],
  ['app_settings', 'INSERT'], ['app_settings', 'UPDATE'],
] as const) {
  check(`policy ${cmd} ada di ${table}`, hasPolicy(table, cmd))
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed}/${passed + failed} pemeriksaan SQL lolos`)
if (failed > 0) {
  console.log(`${failed} pemeriksaan gagal:`)
  for (const name of failures) console.log(` - ${name}`)
  process.exit(1)
}
