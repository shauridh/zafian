/**
 * Uji Fase 1 tanpa project cloud: migration + seed + RLS di Postgres sungguhan
 * (PGlite/Postgres WASM). Bukan pengganti project Supabase staging, tetapi
 * membuktikan DDL, generator seed, foreign key, dan policy bekerja.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'

import { inspectBackupValue } from '../src/lib/backup'
import { normalizeStore } from '../src/lib/schema'
import { buildSeedArtifacts } from '../src/lib/supabase-seed'
import { buildStagingExport, STAGING_TABLES, type StagingManifest, type StagingRow, type StagingTableName } from '../src/lib/sync-staging'

const fixturePath = join(process.cwd(), 'scripts/fixtures/supabase-seed.json')
const fixture = inspectBackupValue(JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown)
if (!fixture.ok) {
  console.error(`Fixture tidak valid: ${fixture.error}`)
  process.exit(1)
}
const store = normalizeStore(fixture.store)
const staging = buildStagingExport(store)
const outletId = '11111111-1111-4111-8111-111111111111'
const ownerUserId = '22222222-2222-4222-8222-222222222222'
const artifacts = buildSeedArtifacts(staging.tables, staging.manifest, { outletId, ownerUserId })

let checks = 0
let failures = 0
function check(name: string, condition: boolean, detail = '') {
  checks += 1
  if (condition) console.log(`PASS ${name}`)
  else { failures += 1; console.error(`FAIL ${name} ${detail}`) }
}

const prelude = readFileSync(join(process.cwd(), 'supabase/local/prelude.sql'), 'utf8')
const initSql = readFileSync(join(process.cwd(), 'supabase/migrations/202610260001_init.sql'), 'utf8')
  .replace(/^create extension if not exists pgcrypto;$/m, '-- PGlite: gen_random_uuid() bawaan PG13+, ekstensi pgcrypto tidak tersedia')
const rlsSql = readFileSync(join(process.cwd(), 'supabase/migrations/202610260002_rls.sql'), 'utf8')
const backupSql = readFileSync(join(process.cwd(), 'supabase/migrations/202610260003_backup_storage.sql'), 'utf8')
const syncSql = readFileSync(join(process.cwd(), 'supabase/migrations/202610260004_sync_changes.sql'), 'utf8')
const rlsFixtures = readFileSync(join(process.cwd(), 'supabase/tests/rls-fixtures.sql'), 'utf8')
const rlsTests = readFileSync(join(process.cwd(), 'supabase/tests/rls.sql'), 'utf8')

const db = new PGlite()

async function run(label: string, sql: string): Promise<boolean> {
  try {
    await db.exec(sql)
    console.log(`PASS ${label}`)
    checks += 1
    return true
  } catch (error) {
    failures += 1
    checks += 1
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

async function main(): Promise<void> {
  if (!await run('prelude lokal (role + auth.uid stub)', prelude)) return
  if (!await run('migration 001 (DDL 22 tabel)', initSql)) return
  if (!await run('migration 002 (RLS lengkap)', rlsSql)) return
  if (!await run('seed SQL dieksekusi', artifacts.seedSql)) return
  if (!await run('verifikasi angka kontrol seed', artifacts.verifySql)) return

  const tables = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)
  check('22 tabel public dibuat', tables.rows.length === 22, `${tables.rows.length}: ${tables.rows.map((row) => row.table_name).join(',')}`)

  const counts = await db.query<{ table: string; count: string }>(`
    select 'transactions' as table, count(*)::text from public.transactions
    union all select 'transaction_items', count(*)::text from public.transaction_items
    union all select 'journal_lines', count(*)::text from public.journal_lines
    union all select 'menu_recipes', count(*)::text from public.menu_recipes
    union all select 'audit_log', count(*)::text from public.audit_log
  `)
  const countMap = Object.fromEntries(counts.rows.map((row) => [row.table, Number(row.count)]))
  check('jumlah transaksi sesuai staging', countMap.transactions === staging.manifest.counts.transactions, JSON.stringify(countMap))
  check('jumlah item transaksi sesuai staging', countMap.transaction_items === staging.manifest.counts.transaction_items, JSON.stringify(countMap))
  check('jumlah baris jurnal sesuai staging', countMap.journal_lines === staging.manifest.counts.journal_lines, JSON.stringify(countMap))
  check('jumlah resep sesuai staging', countMap.menu_recipes === staging.manifest.counts.menu_recipes, JSON.stringify(countMap))
  check('audit log ikut ter-seed', countMap.audit_log === staging.manifest.counts.audit_log, JSON.stringify(countMap))

  const money = await db.query<{ revenue: string; debit: string; credit: string }>(`
    select
      (select coalesce(sum(subtotal), 0) from public.transactions where status = 'completed')::text as revenue,
      (select coalesce(sum(debit), 0) from public.journal_lines)::text as debit,
      (select coalesce(sum(credit), 0) from public.journal_lines)::text as credit
  `)
  check('penjualan di database = kontrol', Number(money.rows[0]?.revenue) === staging.manifest.control.money.revenue, JSON.stringify(money.rows[0]))
  check('jurnal database seimbang', Number(money.rows[0]?.debit) === Number(money.rows[0]?.credit), JSON.stringify(money.rows[0]))

  const outletRows = await db.query<{ count: string }>(`select count(*)::text from public.transactions where outlet_id <> $1`, [outletId])
  check('semua baris memakai outlet target', Number(outletRows.rows[0]?.count) === 0, JSON.stringify(outletRows.rows[0]))

  // Idempotensi seed: jalankan ulang, jumlah tidak boleh bertambah.
  if (await run('seed dijalankan ulang (idempoten)', artifacts.seedSql)) {
    const again = await db.query<{ count: string }>(`select count(*)::text from public.transactions`)
    check('seed ulang tidak menggandakan transaksi', Number(again.rows[0]?.count) === staging.manifest.counts.transactions, JSON.stringify(again.rows[0]))
  }

  if (!await run('fixture RLS (outlet B + kasir)', rlsFixtures)) return
  if (!await run('assertion RLS owner/kasir/outlet lain/anon', rlsTests)) return

  // Fase 2: bucket privat + policy storage per outlet.
  if (!await run('migration 003 (bucket backup + policy storage)', backupSql)) return

  const bucket = await db.query<{ public: boolean; file_size_limit: string }>(
    `select public, file_size_limit::text from storage.buckets where id = 'pos-backups'`,
  )
  check('bucket pos-backups ada dan privat', bucket.rows.length === 1 && bucket.rows[0]?.public === false, JSON.stringify(bucket.rows))
  check('bucket membatasi ukuran file', Number(bucket.rows[0]?.file_size_limit) === 10485760, String(bucket.rows[0]?.file_size_limit))

  const storagePolicies = await db.query<{ policyname: string }>(
    `select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'pos_backups_%' order by 1`,
  )
  check('policy storage backup lengkap', storagePolicies.rows.length === 4, storagePolicies.rows.map((row) => row.policyname).join(','))

  const outletA = '11111111-1111-4111-8111-111111111111'
  const outletB = '44444444-4444-4444-8444-444444444444'
  const ownerA = '22222222-2222-4222-8222-222222222222'
  const cashierA = '33333333-3333-4333-8333-333333333333'

  async function asUser(userId: string, statement: string): Promise<number> {
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', false); set role authenticated;`)
    try {
      const result = await db.query<{ count: string }>(statement)
      return Number(result.rows[0]?.count ?? 0)
    } finally {
      await db.exec('reset role')
    }
  }

  async function expectDenied(label: string, userId: string, statement: string): Promise<void> {
    checks += 1
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', false); set role authenticated;`)
    try {
      await db.exec(statement)
      failures += 1
      console.error(`FAIL ${label} (statement tidak ditolak)`)
    } catch {
      console.log(`PASS ${label}`)
    } finally {
      await db.exec('reset role')
    }
  }

  await db.exec(`insert into storage.objects (bucket_id, name) values
    ('pos-backups', '${outletA}/2026-10-27T08-00-00-daily-a.json.enc')`)
  check('owner dapat membaca snapshot outletnya', await asUser(ownerA, `select count(*)::text from storage.objects where bucket_id = 'pos-backups'`) === 1)
  check('kasir tidak melihat snapshot', await asUser(cashierA, `select count(*)::text from storage.objects where bucket_id = 'pos-backups'`) === 0)
  await expectDenied('kasir tidak dapat mengunggah snapshot', cashierA, `insert into storage.objects (bucket_id, name) values ('pos-backups', '${outletA}/kasir.json.enc')`)
  await expectDenied('owner outlet A tidak dapat menulis folder outlet B', ownerA, `insert into storage.objects (bucket_id, name) values ('pos-backups', '${outletB}/lintas.json.enc')`)
  await expectDenied('path tanpa outlet UUID ditolak', ownerA, `insert into storage.objects (bucket_id, name) values ('pos-backups', 'bukan-uuid/snap.json.enc')`)

  // Fase 3: stream perubahan + RPC pull/apply_sale.
  if (!await run('migration 004 (stream perubahan + RPC sync)', syncSql)) return

  // Wizard hosted menjalankan migration lebih dulu, baru seed. Kolom NOT NULL
  // baru dari migration (row_version, updated_at menu_recipes) tidak boleh
  // membuat seed gagal: insert harus menyebut kolomnya secara eksplisit.
  const beforeReseed = await db.query<{ categories: string; recipes: string }>(
    `select (select count(*)::text from public.categories) as categories,
            (select count(*)::text from public.menu_recipes) as recipes`,
  )
  if (!await run('seed dijalankan ulang setelah semua migration', artifacts.seedSql)) return
  const reseed = await db.query<{ categories: string; recipes: string; null_versions: string }>(
    `select (select count(*)::text from public.categories) as categories,
            (select count(*)::text from public.menu_recipes) as recipes,
            (select count(*)::text from public.categories where row_version is null) as null_versions`,
  )
  check(
    'seed setelah migration tidak menggandakan baris',
    reseed.rows[0]?.categories === beforeReseed.rows[0]?.categories && reseed.rows[0]?.recipes === beforeReseed.rows[0]?.recipes,
    `${JSON.stringify(beforeReseed.rows[0])} → ${JSON.stringify(reseed.rows[0])}`,
  )
  check('kolom row_version terisi default, bukan NULL', Number(reseed.rows[0]?.null_versions) === 0, JSON.stringify(reseed.rows[0]))

  async function asUserJson(userId: string, sql: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', false); set role authenticated;`)
    try {
      const result = await db.query<{ r: unknown }>(sql, params)
      const raw = result.rows[0]?.r
      if (typeof raw === 'string') return JSON.parse(raw) as Record<string, unknown>
      return (raw ?? null) as Record<string, unknown> | null
    } finally {
      await db.exec('reset role')
    }
  }

  async function expectAnonDenied(label: string, sql: string): Promise<void> {
    checks += 1
    await db.exec('set role anon')
    try {
      await db.exec(sql)
      failures += 1
      console.error(`FAIL ${label} (anon tidak ditolak)`)
    } catch {
      console.log(`PASS ${label}`)
    } finally {
      await db.exec('reset role')
    }
  }

  const baseSeq = Number((await db.query<{ seq: string }>(`select coalesce(max(seq), 0)::text as seq from public.outlet_changes`)).rows[0]?.seq ?? 0)

  await db.exec(`insert into public.categories (id, outlet_id, name, sort_order) values ('cat-sync-1', '${outletA}', 'Kategori Sync', 9)`)
  await db.exec(`update public.categories set name = 'Kategori Sync 2' where id = 'cat-sync-1'`)
  await db.exec(`update public.categories set deleted_at = now() where id = 'cat-sync-1'`)
  const changeRows = await db.query<{ seq: string; op: string; row_version: string; entity: string }>(
    `select seq::text, op, row_version::text, entity from public.outlet_changes where outlet_id = $1 and entity_id = 'cat-sync-1' order by seq`,
    [outletA],
  )
  check('trigger mencatat insert, update, dan soft delete', changeRows.rows.length === 3 && changeRows.rows[0]?.op === 'upsert' && changeRows.rows[2]?.op === 'delete', JSON.stringify(changeRows.rows))
  check('row_version naik tiap perubahan', Number(changeRows.rows[2]?.row_version) === 3, JSON.stringify(changeRows.rows.map((row) => row.row_version)))
  check('seq monoton naik dalam satu outlet', changeRows.rows.every((row, index) => index === 0 || Number(row.seq) > Number(changeRows.rows[index - 1]?.seq)))

  const page1 = await asUserJson(ownerA, `select public.pull_changes($1::uuid, $2::bigint, 2) as r`, [outletA, baseSeq])
  const page1Changes = (page1?.changes ?? []) as unknown[]
  check('pull halaman 1 menghormati limit', page1Changes.length === 2 && page1?.has_more === true, JSON.stringify(page1))
  const page2 = await asUserJson(ownerA, `select public.pull_changes($1::uuid, $2::bigint, 2) as r`, [outletA, Number(page1?.next_seq ?? 0)])
  const page2Changes = (page2?.changes ?? []) as unknown[]
  check('pull halaman 2 melanjutkan dari next_seq', page2Changes.length === 1 && page2?.has_more === false, JSON.stringify(page2))
  const page1Seq = page1Changes.map((row) => Number((row as { seq: number }).seq))
  const page2Seq = page2Changes.map((row) => Number((row as { seq: number }).seq))
  check('pull tidak mengulang seq antar halaman', Math.min(...page2Seq) > Math.max(...page1Seq), `${page1Seq.join(',')} | ${page2Seq.join(',')}`)
  const replay = await asUserJson(ownerA, `select public.pull_changes($1::uuid, $2::bigint, 10) as r`, [outletA, Number(page2?.next_seq ?? 0)])
  check('pull berulang di posisi akhir tidak mengulang perubahan', ((replay?.changes ?? []) as unknown[]).length === 0 && replay?.has_more === false, JSON.stringify(replay))

  await expectDenied('owner outlet A tidak bisa pull outlet B', ownerA, `select public.pull_changes('${outletB}'::uuid, 0, 10)`)
  await expectAnonDenied('anon tidak bisa pull_changes', `select public.pull_changes('${outletA}'::uuid, 0, 10)`)
  const cashierPull = await asUserJson(cashierA, `select public.pull_changes($1::uuid, 0, 5) as r`, [outletA])
  check('kasir (member) boleh pull katalog outletnya', cashierPull !== null && Array.isArray(cashierPull?.changes), JSON.stringify(cashierPull))

  await db.exec(`insert into public.shifts (id, outlet_id, opened_at, closed_at, opening_float, actual_cash, status)
    values ('shift-sync-uji', '${outletA}', now() - interval '2 hours', now() - interval '1 hour', 350000, 350000, 'closed')`)
  const salePayload = {
    outlet_id: outletA,
    device_id: 'device-uji',
    transaction: {
      id: 'tx-sync-uji',
      number: 'SYNC-0001',
      created_at: '2026-10-27T10:00:00.000Z',
      order_type: 'Takeaway',
      payment_method: 'Cash',
      subtotal: 25000,
      paid_amount: 30000,
      change_amount: 5000,
      status: 'completed',
      shift_id: 'shift-sync-uji',
    },
    items: [{ id: 'tx-sync-uji-item-1', menu_id: 'dada', name: 'Ayam', category: 'Paket', price: 25000, qty: 1 }],
  }
  const firstSale = await asUserJson(cashierA, `select public.apply_sale($1::jsonb) as r`, [JSON.stringify(salePayload)])
  check('apply_sale menerapkan penjualan baru', firstSale?.applied === true && firstSale?.transaction_id === 'tx-sync-uji', JSON.stringify(firstSale))
  const secondSale = await asUserJson(cashierA, `select public.apply_sale($1::jsonb) as r`, [JSON.stringify(salePayload)])
  check('apply_sale idempoten untuk ID yang sama', secondSale?.applied === false && secondSale?.duplicate === true, JSON.stringify(secondSale))
  const saleRows = await db.query<{ transactions: string; items: string }>(`
    select (select count(*)::text from public.transactions where id = 'tx-sync-uji') as transactions,
           (select count(*)::text from public.transaction_items where transaction_id = 'tx-sync-uji') as items`)
  check('replay apply_sale tidak menggandakan transaksi/item', saleRows.rows[0]?.transactions === '1' && saleRows.rows[0]?.items === '1', JSON.stringify(saleRows.rows[0]))

  const wrongSubtotal = { ...salePayload, transaction: { ...salePayload.transaction, id: 'tx-sync-salah', number: 'SYNC-0002', subtotal: 999 } }
  await expectDenied('apply_sale menolak subtotal yang tidak cocok', cashierA, `select public.apply_sale('${JSON.stringify(wrongSubtotal).replace(/'/g, "''")}'::jsonb)`)
  const crossSale = { ...salePayload, transaction: { ...salePayload.transaction, id: 'tx-sync-lintas', number: 'SYNC-0003' } }
  await expectDenied('apply_sale menolak penjualan lintas outlet', '55555555-5555-4555-8555-555555555555', `select public.apply_sale('${JSON.stringify(crossSale).replace(/'/g, "''")}'::jsonb)`)
  await expectAnonDenied('anon tidak bisa apply_sale', `select public.apply_sale('${JSON.stringify(salePayload).replace(/'/g, "''")}'::jsonb)`)

  const syncPolicies = await db.query<{ policyname: string }>(`select policyname from pg_policies where schemaname = 'public' and tablename = 'outlet_changes'`)
  check('outlet_changes punya policy baca member', syncPolicies.rows.length === 1, JSON.stringify(syncPolicies.rows))

  // Query kesiapan stream yang dipakai wizard hosted (Fase 3).
  const streamReadiness = await db.query<{ tables: number; functions: number }>(
    `select (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name = 'outlet_changes') as tables, ` +
      `(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace ` +
      `where n.nspname = 'public' and p.proname in ('pull_changes', 'apply_sale')) as functions`,
  )
  check('query kesiapan stream (wizard hosted) = tabel + 2 RPC', Number(streamReadiness.rows[0]?.tables) === 1 && Number(streamReadiness.rows[0]?.functions) === 2, JSON.stringify(streamReadiness.rows[0]))

  // Query yang sama dipakai wizard hosted untuk memutuskan menjalankan migration 003.
  const readiness = await db.query<{ buckets: number; policies: number }>(
    `select (select count(*)::int from storage.buckets where id = 'pos-backups') as buckets, ` +
      `(select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'pos_backups_%') as policies`,
  )
  check('query kesiapan bucket (wizard hosted) = 1 bucket + 4 policy', Number(readiness.rows[0]?.buckets) === 1 && Number(readiness.rows[0]?.policies) === 4, JSON.stringify(readiness.rows[0]))

  const disabled = await db.query<{ relname: string }>(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    order by 1
  `)
  check('semua tabel public mengaktifkan RLS', disabled.rows.length === 0, disabled.rows.map((row) => row.relname).join(','))

  const missingPolicy = await db.query<{ tablename: string }>(`
    select t.tablename from pg_tables t
    where t.schemaname = 'public'
      and has_table_privilege('authenticated', to_regclass(format('%I.%I', t.schemaname, t.tablename)), 'select')
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t.tablename and p.cmd in ('SELECT', 'ALL')
      )
    order by 1
  `)
  check('setiap tabel dengan grant SELECT punya policy SELECT', missingPolicy.rows.length === 0, missingPolicy.rows.map((row) => row.tablename).join(','))

  const anonGrants = await db.query<{ tablename: string }>(`
    select tablename from pg_tables
    where schemaname = 'public' and has_table_privilege('anon', to_regclass(format('%I.%I', schemaname, tablename)), 'select')
    order by 1
  `)
  check('anon tidak punya grant SELECT', anonGrants.rows.length === 0, anonGrants.rows.map((row) => row.tablename).join(','))

  const journalOwners = await db.query<{ count: string }>(`select count(*)::text from public.journal_entries where outlet_id <> $1`, [outletId])
  check('jurnal hanya milik outlet target', Number(journalOwners.rows[0]?.count) === 0)

  // CLI seed harus membaca staging (checksum) dan menghasilkan SQL yang sama.
  const workDir = mkdtempSync(join(tmpdir(), 'sabana-seed-'))
  try {
    const stagingDir = join(workDir, 'staging')
    const seedDir = join(workDir, 'seed')
    mkdirSync(stagingDir, { recursive: true })
    const manifest = { ...staging.manifest } as StagingManifest & { files: { table: StagingTableName; rows: number; file: string; sha256: string }[] }
    manifest.files = []
    for (const table of STAGING_TABLES) {
      const content = staging.tables[table].map((row: StagingRow) => JSON.stringify(row)).join('\n') + (staging.tables[table].length > 0 ? '\n' : '')
      const file = `${table}.jsonl`
      writeFileSync(join(stagingDir, file), content, 'utf8')
      manifest.files.push({ table, rows: staging.tables[table].length, file, sha256: createHash('sha256').update(content).digest('hex') })
    }
    writeFileSync(join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const cli = spawnSync('bun', ['run', 'scripts/supabase-seed.ts', '--staging', stagingDir, '--out', seedDir, '--outlet-id', outletId, '--owner-user-id', ownerUserId], { cwd: process.cwd(), encoding: 'utf8' })
    const cliOk = cli.status === 0
    check('CLI seed exit 0', cliOk, cli.stderr || cli.stdout)
    if (cliOk) {
      const cliSeed = readFileSync(join(seedDir, 'seed.sql'), 'utf8')
      check('seed CLI identik dengan builder', cliSeed === artifacts.seedSql)
      const cliVerify = readFileSync(join(seedDir, 'verify.sql'), 'utf8')
      check('verify CLI identik dengan builder', cliVerify === artifacts.verifySql)
    }

    const tampered = join(workDir, 'bad-staging')
    mkdirSync(tampered, { recursive: true })
    for (const file of manifest.files) writeFileSync(join(tampered, file.file), readFileSync(join(stagingDir, file.file)))
    writeFileSync(join(tampered, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    writeFileSync(join(tampered, 'categories.jsonl'), '', 'utf8')
    const bad = spawnSync('bun', ['run', 'scripts/supabase-seed.ts', '--staging', tampered, '--out', join(workDir, 'bad-seed'), '--outlet-id', outletId, '--owner-user-id', ownerUserId], { cwd: process.cwd(), encoding: 'utf8' })
    check('CLI seed menolak checksum staging yang berubah', bad.status === 1, String(bad.status))
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

try {
  await main()
} finally {
  await db.close()
}

if (failures > 0) {
  console.error(`\n${failures} dari ${checks} pemeriksaan database gagal`)
  process.exit(1)
}
console.log(`\nSemua ${checks} pemeriksaan database lolos`)
