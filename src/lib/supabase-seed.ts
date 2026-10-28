/**
 * Generator SQL seed Supabase dari tabel staging Fase 0.
 *
 * Murni string builder: tidak membaca file, tidak menyentuh jaringan, dan tidak
 * mengubah staging. Dipakai CLI scripts/supabase-seed.ts dan uji database lokal.
 * Urutan insert mengikuti foreign key. Baris memakai jsonb_populate_recordset
 * agar nilai teks/emoji/JSON aman, dan kolom selalu disebut eksplisit supaya
 * kolom NOT NULL baru dengan DEFAULT (mis. `row_version` dari migration 004)
 * memakai nilai default-nya, bukan NULL hasil populate_recordset.
 */
import type { StagingManifest, StagingRow, StagingTableName } from './sync-staging'

export type SeedOptions = {
  /** UUID outlet di project Supabase staging. */
  outletId: string
  /** UUID auth.users pemilik outlet (dibuat lewat dashboard/API Supabase). */
  ownerUserId: string
}

export type SeedArtifacts = {
  seedSql: string
  verifySql: string
}

export type MasterSeedOptions = {
  outletId: string
  ownerUserId: string
  /** Identitas awal production; pemilik tetap bisa mengubahnya di tab Pengaturan. */
  outletName?: string
  businessName?: string
  receiptFooter?: string
  paperWidth?: 58 | 80
  copies?: number
}

export type MasterSeedArtifacts = SeedArtifacts & {
  counts: Record<MasterTableName, number>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/

/**
 * Kolom yang benar-benar dikirim staging, urut kemunculan pertama.
 * Kolom di luar daftar ini (mis. kolom baru yang hanya ada di database) tidak
 * disebut sehingga memakai DEFAULT tabel.
 */
function orderedColumns(rows: StagingRow[]): string[] {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue
      if (!IDENTIFIER_PATTERN.test(key)) throw new Error(`Nama kolom staging tidak valid: ${key}`)
      seen.add(key)
      columns.push(key)
    }
  }
  if (columns.length === 0) throw new Error('Baris staging tidak punya kolom.')
  return columns
}

const TABLE_ORDER: StagingTableName[] = [
  'accounts',
  'categories',
  'ingredients',
  'menus',
  'menu_recipes',
  'shifts',
  'transactions',
  'transaction_items',
  'cash_movements',
  'stock_movements',
  'expenses',
  'preorders',
  'preorder_items',
  'journal_entries',
  'journal_lines',
  'audit_log',
]

const SERVER_STAMP_TABLES = new Set<StagingTableName>(['transactions', 'cash_movements', 'stock_movements', 'expenses'])

/** Tabel master yang aman dipindahkan ke production baru (tanpa riwayat operasional). */
export const MASTER_TABLES = [
  'outlets',
  'outlet_settings',
  'outlet_counters',
  'accounts',
  'categories',
  'ingredients',
  'menus',
  'menu_recipes',
] as const satisfies readonly StagingTableName[]

export type MasterTableName = typeof MASTER_TABLES[number]

/** Tabel yang harus tetap kosong pada production yang baru di-seed master data. */
export const OPERATIONAL_TABLES = [
  'shifts',
  'transactions',
  'transaction_items',
  'cash_movements',
  'stock_movements',
  'expenses',
  'preorders',
  'preorder_items',
  'journal_entries',
  'journal_lines',
  'audit_log',
  'outlet_snapshots',
] as const

const sqlText = (value: unknown): string => `'${String(value ?? '').replace(/'/g, "''")}'`
const sqlNumber = (value: unknown): string => {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) throw new Error(`Nilai numerik tidak valid untuk seed: ${String(value)}`)
  return String(number)
}
const sqlBoolean = (value: unknown): string => value === true ? 'true' : 'false'
const sqlJsonb = (rows: StagingRow[]): string => `'${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb`

function requireRow(tables: Record<StagingTableName, StagingRow[]>, table: StagingTableName): StagingRow {
  const row = tables[table][0]
  if (!row) throw new Error(`Staging tidak memiliki baris ${table}; jalankan exporter Fase 0 lebih dulu.`)
  return row
}

function remapOutlet(rows: StagingRow[], outletId: string): StagingRow[] {
  return rows.map((row) => {
    const next = 'outlet_id' in row ? { ...row, outlet_id: outletId } : { ...row }
    return next
  })
}

function assertCounts(tables: Record<StagingTableName, StagingRow[]>, manifest: StagingManifest): void {
  for (const [table, count] of Object.entries(manifest.counts) as [StagingTableName, number][]) {
    const actual = tables[table]?.length ?? 0
    if (actual !== count) throw new Error(`Jumlah baris ${table} (${actual}) tidak sama dengan manifest (${count}).`)
  }
}

export function buildSeedArtifacts(
  tables: Record<StagingTableName, StagingRow[]>,
  manifest: StagingManifest,
  options: SeedOptions,
): SeedArtifacts {
  if (!UUID_PATTERN.test(options.outletId)) throw new Error(`outletId bukan UUID valid: ${options.outletId}`)
  if (!UUID_PATTERN.test(options.ownerUserId)) throw new Error(`ownerUserId bukan UUID valid: ${options.ownerUserId}`)
  assertCounts(tables, manifest)

  const outlet = requireRow(tables, 'outlets')
  const settings = requireRow(tables, 'outlet_settings')
  const counter = requireRow(tables, 'outlet_counters')
  const { outletId, ownerUserId } = options

  const seedParts: string[] = []
  seedParts.push('-- Seed Supabase staging dari exporter Fase 0 Sabana POS.')
  seedParts.push(`-- Sumber staging: ${manifest.outletId} / ${manifest.deviceId} • dibuat ${manifest.generatedAt}`)
  seedParts.push(`-- Target outlet: ${outletId}`)
  seedParts.push('-- Idempoten: semua insert memakai on conflict do nothing.')
  seedParts.push('-- Kolom disebut eksplisit; kolom NOT NULL baru dengan DEFAULT tetap memakai default.')
  seedParts.push('')
  seedParts.push('begin;')
  seedParts.push('')
  seedParts.push('-- Identitas dan pengaturan')
  seedParts.push(`insert into public.outlets (id, name, timezone, currency, created_at) values (${sqlText(outletId)}, ${sqlText(outlet.name ?? settings.outlet_name ?? 'Outlet')}, ${sqlText(outlet.timezone ?? 'Asia/Jakarta')}, ${sqlText(outlet.currency ?? 'IDR')}, ${sqlText(outlet.created_at ?? manifest.generatedAt)}) on conflict (id) do nothing;`)
  seedParts.push(`insert into public.outlet_settings (outlet_id, business_name, outlet_name, receipt_footer, paper_width, header_align, footer_align, font_size, show_order_type, show_payment_detail, copies, app_schema_version, revision, updated_at) values (${sqlText(outletId)}, ${sqlText(settings.business_name)}, ${sqlText(settings.outlet_name)}, ${sqlText(settings.receipt_footer)}, ${sqlNumber(settings.paper_width)}, ${sqlText(settings.header_align)}, ${sqlText(settings.footer_align)}, ${sqlText(settings.font_size)}, ${sqlBoolean(settings.show_order_type)}, ${sqlBoolean(settings.show_payment_detail)}, ${sqlNumber(settings.copies)}, ${sqlNumber(settings.app_schema_version)}, ${sqlNumber(settings.revision)}, ${sqlText(settings.updated_at ?? manifest.generatedAt)}) on conflict (outlet_id) do nothing;`)
  seedParts.push(`insert into public.outlet_counters (outlet_id, next_transaction_number) values (${sqlText(outletId)}, ${sqlNumber(counter.next_transaction_number)}) on conflict (outlet_id) do nothing;`)
  seedParts.push(`insert into public.outlet_members (outlet_id, user_id, role) values (${sqlText(outletId)}, ${sqlText(ownerUserId)}, 'owner') on conflict (outlet_id, user_id) do nothing;`)
  seedParts.push('')

  for (const table of TABLE_ORDER) {
    const rows = tables[table]
    if (rows.length === 0) continue
    const prepared = remapOutlet(rows, outletId).map((row) => {
      if (!SERVER_STAMP_TABLES.has(table)) return row
      return { ...row, created_at_server: row.created_at_server ?? row.created_at }
    })
    const columns = orderedColumns(prepared)
    const projection = columns.join(', ')
    seedParts.push(`-- ${table}: ${prepared.length} baris`)
    seedParts.push(`insert into public.${table} (${projection})`)
    seedParts.push(`select ${projection} from jsonb_populate_recordset(null::public.${table}, ${sqlJsonb(prepared)})`)
    seedParts.push('on conflict do nothing;')
    seedParts.push('')
  }

  seedParts.push('commit;')

  const verifyParts: string[] = []
  verifyParts.push('-- Verifikasi seed: jumlah baris, angka kontrol, kas per shift, dan jurnal.')
  verifyParts.push('do $verify$')
  verifyParts.push('declare v numeric;')
  verifyParts.push('begin')
  for (const table of Object.keys(manifest.counts) as StagingTableName[]) {
    const expected = manifest.counts[table]
    verifyParts.push(`  select count(*) into v from public.${table};`)
    verifyParts.push(`  if v <> ${expected} then raise exception 'Seed gagal: ${table} %, seharusnya ${expected}', v; end if;`)
  }
  verifyParts.push(`  select count(*) into v from public.outlet_members where outlet_id = ${sqlText(outletId)} and role = 'owner';`)
  verifyParts.push('  if v <> 1 then raise exception \'Seed gagal: owner membership %, seharusnya 1\', v; end if;')

  const control = manifest.control
  const numericChecks: [string, string, number][] = [
    ['transactions selesai', `select count(*) from public.transactions where status = 'completed'`, control.transactions.completed],
    ['penjualan', `select coalesce(sum(subtotal), 0) from public.transactions where status = 'completed'`, control.money.revenue],
    ['pembayaran', `select coalesce(sum(paid_amount), 0) from public.transactions where status = 'completed'`, control.money.paid],
    ['kembalian', `select coalesce(sum(change_amount), 0) from public.transactions where status = 'completed'`, control.money.change],
    ['kas tunai', `select coalesce(sum(paid_amount - change_amount), 0) from public.transactions where status = 'completed' and payment_method = 'Cash'`, control.money.cashSales],
    ['penjualan QRIS', `select coalesce(sum(subtotal), 0) from public.transactions where status = 'completed' and payment_method = 'QRIS'`, control.money.qrisSales],
    ['penjualan unpaid', `select coalesce(sum(subtotal), 0) from public.transactions where status = 'completed' and payment_method = 'Unpaid'`, control.money.unpaidSales],
    ['nilai pembelian stok', `select coalesce(sum(total_cost), 0) from public.stock_movements where type = 'purchase'`, control.inventory.purchaseValue],
    ['nilai selisih opname', `select coalesce(sum(round(abs(qty) * coalesce(unit_cost, 0), 2)), 0) from public.stock_movements where type = 'opname'`, control.inventory.opnameAdjustment],
    ['debit jurnal', `select coalesce(sum(debit), 0) from public.journal_lines`, control.journals.debit],
    ['kredit jurnal', `select coalesce(sum(credit), 0) from public.journal_lines`, control.journals.credit],
  ]
  for (const [label, query, expected] of numericChecks) {
    verifyParts.push(`  ${query} into v;`)
    verifyParts.push(`  if round(v, 2) <> round(${expected}::numeric, 2) then raise exception 'Seed gagal: ${label} %, seharusnya ${expected}', v; end if;`)
  }
  verifyParts.push(`  select count(*) into v from public.journal_entries;`)
  verifyParts.push(`  if v <> ${control.journals.entries} then raise exception 'Seed gagal: entri jurnal %, seharusnya ${control.journals.entries}', v; end if;`)
  verifyParts.push(`  select count(*) into v from public.journal_lines;`)
  verifyParts.push(`  if v <> ${control.journals.lines} then raise exception 'Seed gagal: baris jurnal %, seharusnya ${control.journals.lines}', v; end if;`)

  for (const shift of control.shifts) {
    verifyParts.push(`  select s.opening_float`)
    verifyParts.push(`    + coalesce((select sum(t.paid_amount - t.change_amount) from public.transactions t where t.shift_id = s.id and t.status = 'completed' and t.payment_method = 'Cash'), 0)`)
    verifyParts.push(`    + coalesce((select sum(c.amount) from public.cash_movements c where c.shift_id = s.id and c.type = 'in'), 0)`)
    verifyParts.push(`    - coalesce((select sum(c.amount) from public.cash_movements c where c.shift_id = s.id and c.type = 'out'), 0)`)
    verifyParts.push(`  into v from public.shifts s where s.id = ${sqlText(shift.shiftId)};`)
    verifyParts.push(`  if round(v, 2) <> round(${shift.expectedCash}::numeric, 2) then raise exception 'Seed gagal: kas ${shift.shiftId} %, seharusnya ${shift.expectedCash}', v; end if;`)
    if (shift.actualCash !== null) {
      verifyParts.push(`  select actual_cash into v from public.shifts where id = ${sqlText(shift.shiftId)};`)
      verifyParts.push(`  if round(v, 2) <> round(${shift.actualCash}::numeric, 2) then raise exception 'Seed gagal: kas fisik ${shift.shiftId} %, seharusnya ${shift.actualCash}', v; end if;`)
    }
  }

  for (const table of TABLE_ORDER) {
    if (!('outlet_id' in (tables[table][0] ?? {}))) continue
    verifyParts.push(`  select count(*) into v from public.${table} where outlet_id <> ${sqlText(outletId)};`)
    verifyParts.push(`  if v <> 0 then raise exception 'Seed gagal: ${table} %, baris bukan outlet target', v; end if;`)
  }

  verifyParts.push('  raise notice \'Seed & verifikasi kontrol lolos\';')
  verifyParts.push('end $verify$;')

  return { seedSql: `${seedParts.join('\n')}\n`, verifySql: `${verifyParts.join('\n')}\n` }
}

/**
 * Seed production: hanya master data, tanpa transaksi, shift, stok, jurnal, atau audit.
 * Nomor transaksi dimulai dari 1 agar struk production tidak mewarisi POS-274 demo.
 */
export function buildMasterSeedArtifacts(
  tables: Record<StagingTableName, StagingRow[]>,
  options: MasterSeedOptions,
): MasterSeedArtifacts {
  if (!UUID_PATTERN.test(options.outletId)) throw new Error(`outletId bukan UUID valid: ${options.outletId}`)
  if (!UUID_PATTERN.test(options.ownerUserId)) throw new Error(`ownerUserId bukan UUID valid: ${options.ownerUserId}`)

  const sourceOutlet = requireRow(tables, 'outlets')
  const sourceSettings = requireRow(tables, 'outlet_settings')
  const { outletId, ownerUserId } = options
  const outletName = (options.outletName ?? 'Sabana POS').trim() || 'Sabana POS'
  const businessName = (options.businessName ?? outletName).trim() || outletName
  const receiptFooter = (options.receiptFooter ?? 'Terima kasih sudah mampir').trim()
  const paperWidth = options.paperWidth ?? 80
  const copies = Math.max(1, Math.trunc(options.copies ?? 1))
  const appSchemaVersion = Math.max(8, Number(sourceSettings.app_schema_version ?? 8))
  const now = new Date().toISOString()

  const counts = Object.fromEntries(MASTER_TABLES.map((table) => [table, tables[table]?.length ?? 0])) as Record<MasterTableName, number>
  for (const table of MASTER_TABLES) {
    if (counts[table] === 0) throw new Error(`Staging tidak memiliki master data ${table}.`)
  }

  const seedParts: string[] = []
  seedParts.push('-- Seed PRODUCTION: master data saja (tanpa transaksi/shift/jurnal).')
  seedParts.push(`-- Sumber staging: ${String(sourceOutlet.name ?? 'outlet')} • dibuat ${now}`)
  seedParts.push(`-- Target outlet: ${outletId}`)
  seedParts.push('-- Idempoten: semua insert memakai on conflict do nothing.')
  seedParts.push('')
  seedParts.push('begin;')
  seedParts.push('')
  seedParts.push('-- Identitas, pengaturan awal, counter, dan owner')
  seedParts.push(
    `insert into public.outlets (id, name, timezone, currency, created_at) values (${sqlText(outletId)}, ${sqlText(outletName)}, ${sqlText(sourceOutlet.timezone ?? 'Asia/Jakarta')}, ${sqlText(sourceOutlet.currency ?? 'IDR')}, ${sqlText(now)}) on conflict (id) do nothing;`,
  )
  seedParts.push(
    `insert into public.outlet_settings (outlet_id, business_name, outlet_name, receipt_footer, paper_width, header_align, footer_align, font_size, show_order_type, show_payment_detail, copies, app_schema_version, revision, updated_at) values (${sqlText(outletId)}, ${sqlText(businessName)}, ${sqlText(outletName)}, ${sqlText(receiptFooter)}, ${sqlNumber(paperWidth)}, ${sqlText(sourceSettings.header_align ?? 'center')}, ${sqlText(sourceSettings.footer_align ?? 'center')}, ${sqlText(sourceSettings.font_size ?? 'large')}, true, true, ${sqlNumber(copies)}, ${sqlNumber(appSchemaVersion)}, 1, ${sqlText(now)}) on conflict (outlet_id) do nothing;`,
  )
  seedParts.push(
    `insert into public.outlet_counters (outlet_id, next_transaction_number) values (${sqlText(outletId)}, 1) on conflict (outlet_id) do nothing;`,
  )
  seedParts.push(
    `insert into public.outlet_members (outlet_id, user_id, role) values (${sqlText(outletId)}, ${sqlText(ownerUserId)}, 'owner') on conflict (outlet_id, user_id) do nothing;`,
  )
  seedParts.push('')

  for (const table of ['accounts', 'categories', 'ingredients', 'menus', 'menu_recipes'] as const) {
    const rows = tables[table]
    if (rows.length === 0) continue
    const prepared = remapOutlet(rows, outletId)
    const columns = orderedColumns(prepared)
    const projection = columns.join(', ')
    seedParts.push(`-- ${table}: ${prepared.length} baris`)
    seedParts.push(`insert into public.${table} (${projection})`)
    seedParts.push(`select ${projection} from jsonb_populate_recordset(null::public.${table}, ${sqlJsonb(prepared)})`)
    seedParts.push('on conflict do nothing;')
    seedParts.push('')
  }

  seedParts.push('commit;')

  const verifyParts: string[] = []
  verifyParts.push('-- Verifikasi production: master lengkap, operasional kosong, nomor struk mulai dari 1.')
  verifyParts.push('do $verify$')
  verifyParts.push('declare v numeric;')
  verifyParts.push('begin')
  for (const table of MASTER_TABLES) {
    verifyParts.push(`  select count(*) into v from public.${table};`)
    verifyParts.push(`  if v <> ${counts[table]} then raise exception 'Production seed gagal: ${table} %, seharusnya ${counts[table]}', v; end if;`)
  }
  for (const table of OPERATIONAL_TABLES) {
    verifyParts.push(`  select count(*) into v from public.${table};`)
    verifyParts.push(`  if v <> 0 then raise exception 'Production seed gagal: ${table} harus kosong, ditemukan %', v; end if;`)
  }
  verifyParts.push(`  select count(*) into v from public.outlet_members where outlet_id = ${sqlText(outletId)} and role = 'owner' and user_id = ${sqlText(ownerUserId)};`)
  verifyParts.push("  if v <> 1 then raise exception 'Production seed gagal: owner membership %, seharusnya 1', v; end if;")
  verifyParts.push(`  select next_transaction_number into v from public.outlet_counters where outlet_id = ${sqlText(outletId)};`)
  verifyParts.push("  if v <> 1 then raise exception 'Production seed gagal: nomor transaksi awal %, seharusnya 1', v; end if;")
  for (const table of ['categories', 'ingredients', 'menus', 'menu_recipes'] as const) {
    verifyParts.push(`  select count(*) into v from public.${table} where outlet_id <> ${sqlText(outletId)};`)
    verifyParts.push(`  if v <> 0 then raise exception 'Production seed gagal: ${table} %, baris bukan outlet target', v; end if;`)
  }
  verifyParts.push("  raise notice 'Production seed & verifikasi master lolos';")
  verifyParts.push('end $verify$;')

  return { seedSql: `${seedParts.join('\n')}\n`, verifySql: `${verifyParts.join('\n')}\n`, counts }
}

/** Terapkan outlet target ke tabel staging (dipakai CLI sebelum menulis SQL). */
export function remapStagingOutlet(
  tables: Record<StagingTableName, StagingRow[]>,
  outletId: string,
): Record<StagingTableName, StagingRow[]> {
  return Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, remapOutlet(rows, outletId)]),
  ) as Record<StagingTableName, StagingRow[]>
}

export { TABLE_ORDER as SEED_TABLE_ORDER }
