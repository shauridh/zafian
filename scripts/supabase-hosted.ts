/**
 * Fase 1 hosted: siapkan project Supabase staging dari nol.
 *
 * Alur:
 *   1. baca organization + project (buat bila belum ada)
 *   2. tunggu project ACTIVE_HEALTHY
 *   3. jalankan supabase/migrations/*.sql (DDL + RLS)
 *   4. buat/temukan user owner di Supabase Auth
 *   5. buat seed dari staging/supabase lalu jalankan seed.sql + verify.sql
 *   6. verifikasi independen lewat PostgREST dan tulis laporan
 *
 * Mode `--verify-only` hanya menjalankan langkah 6 pada project yang sudah ada:
 * tidak membuat project, tidak menjalankan DDL, dan tidak men-seed ulang.
 *
 * Token TIDAK pernah dicetak/ditulis. Jalankan lewat scripts/supabase-hosted.sh
 * agar token diminta dengan input tersembunyi.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'

const API = 'https://api.supabase.com'
const ROOT = resolve(new URL('..', import.meta.url).pathname)
const MIGRATION_DIR = resolve(ROOT, 'supabase/migrations')
const SEED_DIR = resolve(ROOT, 'supabase/seed')
const STAGING_DIR = resolve(ROOT, 'staging/supabase')
const REPORT_PATH = resolve(ROOT, 'supabase/hosted-report.json')
const STATE_PATH = resolve(ROOT, 'supabase/hosted.json')

const DEFAULT_PROJECT_NAMES = ['sabana-pos-staging', 'bisnis-pos-staging']
const REQUEST_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 10_000
const PROJECT_TIMEOUT_MS = 15 * 60_000

const VERIFY_ONLY = process.argv.includes('--verify-only') || process.env.SUPABASE_VERIFY_ONLY === '1'

type Org = { id: string; name: string; slug?: string }
type Project = {
  id: string
  ref: string
  name: string
  region?: string
  status: string
  organization_slug?: string
  organization_id?: string
}
type Profile = { primary_email?: string; username?: string }
type ApiKey = { api_key: string; type: string; name: string }
type AuthUser = { id: string; email?: string }
type Region = { name: string; code: string; type: 'smartGroup' | 'specific'; provider?: string; status?: string }
type RegionSelection = { type: 'smartGroup' | 'specific'; code: string; provider?: string }
type RegionResponse = {
  recommendations?: { smartGroup?: Region; specific?: Region[] }
  all?: { smartGroup?: Region[]; specific?: Region[] }
}
type Manifest = {
  counts: Record<string, number>
  control: {
    money: { revenue: number; paid: number; change: number; cashSales: number; qrisSales: number; unpaidSales: number }
    inventory: { purchaseValue: number; opnameAdjustment: number }
    journals: { entries: number; lines: number; debit: number; credit: number }
    shifts: { shiftId: string; expectedCash: number; actualCash: number | null }[]
  }
}
type Check = { name: string; ok: boolean; detail: string }
type Row = Record<string, unknown>
type SyncProbe = {
  page1?: { changes?: unknown[]; has_more?: boolean; next_seq?: number }
  page2?: { changes?: unknown[]; has_more?: boolean }
  sale1?: { applied?: boolean; duplicate?: boolean; transaction_id?: string }
  sale2?: { applied?: boolean; duplicate?: boolean }
  cross?: string
  anon?: string
  tx_rows?: number
  leftover?: number
  error?: string
}

type HostedState = {
  projectRef?: string
  projectName?: string
  region?: string | null
  apiUrl?: string
  outletId?: string
  ownerId?: string
  ownerEmail?: string
  updatedAt?: string
}

type VerificationResult = {
  checks: Check[]
  observedCounts: Record<string, number>
  journal: { entries: number; lines: number; debit: number; credit: number; balanced: boolean }
  control: {
    revenue: number
    paid: number
    change: number
    cashSales: number
    qrisSales: number
    unpaidSales: number
    purchaseValue: number
    opnameValue: number
  }
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const secrets = new Set<string>()
const token = (process.env.SUPABASE_ACCESS_TOKEN ?? '').trim()
if (!token) {
  fail(
    'SUPABASE_ACCESS_TOKEN kosong. Jalankan `bun run supabase:hosted` atau `bun run supabase:verify` ' +
      'agar token diminta lewat input tersembunyi.',
  )
}
secrets.add(token)
if (!token.startsWith('sbp_')) {
  warn('Token tidak berawalan sbp_. Kemungkinan ini anon/service key project, bukan Personal Access Token akun.')
}

const redact = (value: string): string => {
  let result = value
  for (const secret of secrets) {
    if (secret.length >= 8) result = result.split(secret).join('[REDACTED]')
  }
  return result
}

function fail(message: string): never {
  console.error(`\n✖ ${redact(message)}`)
  process.exit(1)
}

function log(message: string): void {
  console.log(message)
}

function ok(message: string): void {
  console.log(`✔ ${message}`)
}

function warn(message: string): void {
  console.log(`! ${message}`)
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET'
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    throw new ApiError(`${method} ${path} gagal: ${error instanceof Error ? error.message : String(error)}`, 0)
  }
  const text = await response.text()
  if (!response.ok) {
    throw new ApiError(`${method} ${path} → HTTP ${response.status}: ${redact(text).slice(0, 1200)}`, response.status)
  }
  if (!text) return null as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(`${method} ${path} mengembalikan respons bukan JSON: ${redact(text).slice(0, 300)}`, response.status)
  }
}

function rowsOf(raw: unknown): Row[] {
  if (Array.isArray(raw)) return raw as Row[]
  if (raw && typeof raw === 'object') {
    for (const key of ['result', 'results', 'data', 'rows']) {
      const value = (raw as Record<string, unknown>)[key]
      if (Array.isArray(value)) return value as Row[]
    }
  }
  return []
}

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const round2 = (value: number): number => Math.round(value * 100) / 100
const idr = (value: number): string => `Rp${value.toLocaleString('id-ID')}`

let rl: ReturnType<typeof createInterface> | null = null
async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    fail(`Butuh input interaktif untuk "${question}". Jalankan di terminal, bukan pipe.`)
  }
  rl ??= createInterface({ input: process.stdin, output: process.stdout })
  return (await rl.question(`${question}: `)).trim()
}
function closePrompt(): void {
  rl?.close()
  rl = null
}

const randomPassword = (): string => randomBytes(24).toString('base64url')

function readManifest(): Manifest {
  const manifestPath = resolve(STAGING_DIR, 'manifest.json')
  if (!existsSync(manifestPath)) {
    fail(
      `Staging tidak ditemukan di ${STAGING_DIR}.\n` +
        'Jalankan `bun run sync:export --input <backup.json> --out staging/supabase` lebih dulu.',
    )
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  } catch (error) {
    fail(`Manifest staging tidak bisa dibaca: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function listMigrations(): string[] {
  return readdirSync(MIGRATION_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
}

async function runRestChecks(input: {
  ref: string
  secretKey: string
  manifest: Manifest
  outletId: string
  ownerId: string
}): Promise<VerificationResult> {
  const { ref, secretKey, manifest, outletId, ownerId } = input
  const checks: Check[] = []
  const addCheck = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, ok: pass, detail })
    if (pass) ok(`${name}: ${detail}`)
    else console.error(`✖ ${name}: ${detail}`)
  }

  const observedCounts: Record<string, number> = {}
  for (const [table, expected] of Object.entries(manifest.counts)) {
    // Beberapa tabel memakai primary key komposit (mis. menu_recipes), jadi hitung baris
    // dengan select=* alih-alih mengasumsikan kolom id.
    const rows = await restRows<Row>(ref, secretKey, `${table}?select=*&limit=1000`)
    observedCounts[table] = rows.length
    addCheck(`Baris ${table}`, rows.length === expected, `${rows.length} / ${expected}`)
  }

  const transactions = await restRows<Row>(ref, secretKey, 'transactions?select=subtotal,paid_amount,change_amount,payment_method,status,shift_id&limit=1000')
  const completed = transactions.filter((row) => row.status === 'completed')
  const revenue = round2(completed.reduce((sum, row) => sum + num(row.subtotal), 0))
  const paid = round2(completed.reduce((sum, row) => sum + num(row.paid_amount), 0))
  const change = round2(completed.reduce((sum, row) => sum + num(row.change_amount), 0))
  const cashSales = round2(
    completed
      .filter((row) => row.payment_method === 'Cash')
      .reduce((sum, row) => sum + num(row.paid_amount) - num(row.change_amount), 0),
  )
  const qrisSales = round2(completed.filter((row) => row.payment_method === 'QRIS').reduce((sum, row) => sum + num(row.subtotal), 0))
  const unpaidSales = round2(completed.filter((row) => row.payment_method === 'Unpaid').reduce((sum, row) => sum + num(row.subtotal), 0))

  addCheck('Penjualan', revenue === manifest.control.money.revenue, `${idr(revenue)} / ${idr(manifest.control.money.revenue)}`)
  addCheck('Pembayaran', paid === manifest.control.money.paid, `${idr(paid)} / ${idr(manifest.control.money.paid)}`)
  addCheck('Kembalian', change === manifest.control.money.change, `${idr(change)} / ${idr(manifest.control.money.change)}`)
  addCheck('Kas tunai', cashSales === manifest.control.money.cashSales, `${idr(cashSales)} / ${idr(manifest.control.money.cashSales)}`)
  addCheck('Penjualan QRIS', qrisSales === manifest.control.money.qrisSales, `${idr(qrisSales)} / ${idr(manifest.control.money.qrisSales)}`)
  addCheck('Penjualan unpaid', unpaidSales === manifest.control.money.unpaidSales, `${idr(unpaidSales)} / ${idr(manifest.control.money.unpaidSales)}`)

  const journalLines = await restRows<Row>(ref, secretKey, 'journal_lines?select=debit,credit&limit=1000')
  const journalEntries = await restRows<Row>(ref, secretKey, 'journal_entries?select=id&limit=1000')
  const debit = round2(journalLines.reduce((sum, row) => sum + num(row.debit), 0))
  const credit = round2(journalLines.reduce((sum, row) => sum + num(row.credit), 0))
  addCheck('Jurnal seimbang', debit === credit, `debit ${idr(debit)} = kredit ${idr(credit)}`)
  addCheck('Debit jurnal', debit === manifest.control.journals.debit, `${idr(debit)} / ${idr(manifest.control.journals.debit)}`)
  addCheck('Kredit jurnal', credit === manifest.control.journals.credit, `${idr(credit)} / ${idr(manifest.control.journals.credit)}`)
  addCheck('Entri jurnal', journalEntries.length === manifest.control.journals.entries, `${journalEntries.length} / ${manifest.control.journals.entries}`)
  addCheck('Baris jurnal', journalLines.length === manifest.control.journals.lines, `${journalLines.length} / ${manifest.control.journals.lines}`)

  const stock = await restRows<Row>(ref, secretKey, 'stock_movements?select=type,total_cost,qty,unit_cost&limit=1000')
  const purchaseValue = round2(stock.filter((row) => row.type === 'purchase').reduce((sum, row) => sum + num(row.total_cost), 0))
  const opnameValue = round2(
    stock
      .filter((row) => row.type === 'opname')
      .reduce((sum, row) => sum + Math.abs(num(row.qty)) * num(row.unit_cost), 0),
  )
  addCheck('Nilai pembelian stok', purchaseValue === manifest.control.inventory.purchaseValue, `${idr(purchaseValue)} / ${idr(manifest.control.inventory.purchaseValue)}`)
  addCheck('Selisih opname', opnameValue === manifest.control.inventory.opnameAdjustment, `${idr(opnameValue)} / ${idr(manifest.control.inventory.opnameAdjustment)}`)

  const shifts = await restRows<Row>(ref, secretKey, 'shifts?select=id,opening_float,actual_cash,status&limit=1000')
  const cashMovements = await restRows<Row>(ref, secretKey, 'cash_movements?select=shift_id,type,amount&limit=1000')
  for (const shift of manifest.control.shifts) {
    const row = shifts.find((entry) => entry.id === shift.shiftId)
    if (!row) {
      addCheck(`Shift ${shift.shiftId}`, false, 'tidak ditemukan')
      continue
    }
    const shiftCash = completed
      .filter((entry) => entry.shift_id === shift.shiftId && entry.payment_method === 'Cash')
      .reduce((sum, entry) => sum + num(entry.paid_amount) - num(entry.change_amount), 0)
    const cashIn = cashMovements
      .filter((entry) => entry.shift_id === shift.shiftId && entry.type === 'in')
      .reduce((sum, entry) => sum + num(entry.amount), 0)
    const cashOut = cashMovements
      .filter((entry) => entry.shift_id === shift.shiftId && entry.type === 'out')
      .reduce((sum, entry) => sum + num(entry.amount), 0)
    const expected = round2(num(row.opening_float) + shiftCash + cashIn - cashOut)
    addCheck(`Kas shift ${shift.shiftId}`, expected === shift.expectedCash, `${idr(expected)} / ${idr(shift.expectedCash)}`)
    if (shift.actualCash !== null) {
      addCheck(`Kas fisik ${shift.shiftId}`, round2(num(row.actual_cash)) === shift.actualCash, `${idr(num(row.actual_cash))} / ${idr(shift.actualCash)}`)
    }
  }

  const members = await restRows<Row>(ref, secretKey, `outlet_members?select=role,user_id&outlet_id=eq.${outletId}`)
  addCheck('Owner membership', members.length === 1 && members[0].role === 'owner' && members[0].user_id === ownerId, `${members.length} baris`)

  const policies = await countPolicies(ref)
  if (policies !== null) addCheck('Policy RLS', policies > 0, `${policies} policy`)

  // Fase 2: bucket backup privat dan policy storage per outlet.
  const backupReady = await backupBucketReady(ref)
  if (backupReady !== null) {
    addCheck('Bucket backup privat', backupReady, backupReady ? 'pos-backups + policy storage siap' : 'bucket atau policy belum dibuat')
  }

  // Fase 3: stream perubahan + RPC sinkronisasi.
  const streamReady = await syncStreamReady(ref)
  if (streamReady !== null) {
    addCheck(
      'Stream sinkronisasi',
      streamReady,
      streamReady
        ? 'outlet_changes + pull_changes + apply_sale + publikasi realtime siap'
        : 'migration 004 belum terpasang / outlet_changes belum masuk publikasi realtime',
    )
  }

  // Fase 3: panggil RPC sungguhan di project hosted. Semua perubahan dibuat di dalam
  // satu transaksi lalu di-rollback, jadi pemeriksaan ini tidak menulis data permanen.
  if (streamReady === true) {
    const probe = await syncRpcProbe(ref, outletId, ownerId)
    if (probe?.error) {
      addCheck('Probe RPC sinkronisasi (hosted)', false, probe.error)
    } else if (probe) {
      const page1 = (probe.page1?.changes ?? []) as Row[]
      const page2 = (probe.page2?.changes ?? []) as Row[]
      const seq1 = page1.map((row) => num(row.seq))
      const seq2 = page2.map((row) => num(row.seq))
      addCheck(
        'pull_changes halaman 1 (hosted)',
        page1.length === 2 && probe.page1?.has_more === true,
        `${page1.length} baris • has_more=${probe.page1?.has_more} • next_seq=${probe.page1?.next_seq}`,
      )
      addCheck(
        'pull_changes halaman 2 (hosted)',
        page2.length === 1 && probe.page2?.has_more === false,
        `${page2.length} baris • has_more=${probe.page2?.has_more}`,
      )
      addCheck(
        'pull_changes seq berurutan (hosted)',
        seq1.length === 2 && seq2.length === 1 && Math.min(...seq2) > Math.max(...seq1),
        `${seq1.join(',')} → ${seq2.join(',')}`,
      )
      addCheck('pull_changes mengirim tombstone (hosted)', page2[0]?.op === 'delete', `op=${String(page2[0]?.op)}`)
      addCheck('apply_sale menerapkan penjualan (hosted)', probe.sale1?.applied === true, JSON.stringify(probe.sale1))
      addCheck(
        'apply_sale idempoten (hosted)',
        probe.sale2?.applied === false && probe.sale2?.duplicate === true && num(probe.tx_rows) === 1,
        `${JSON.stringify(probe.sale2)} • ${num(probe.tx_rows)} baris transaksi`,
      )
      addCheck('pull_changes menolak lintas outlet (hosted)', probe.cross === 'denied:42501', String(probe.cross))
      addCheck('pull_changes menolak anon (hosted)', probe.anon === 'denied:42501', String(probe.anon))
      addCheck('Probe RPC tidak meninggalkan data (hosted)', num(probe.leftover) === 0, `${num(probe.leftover)} baris sisa`)
    }
  }

  return {
    checks,
    observedCounts,
    journal: { entries: journalEntries.length, lines: journalLines.length, debit, credit, balanced: debit === credit },
    control: { revenue, paid, change, cashSales, qrisSales, unpaidSales, purchaseValue, opnameValue },
  }
}

function writeHostedReport(input: {
  project: Project
  ref: string
  outletId: string
  owner: { userId: string; email: string | null }
  migrations: string[]
  manifest: Manifest
  result: VerificationResult
}): Check[] {
  const { project, ref, outletId, owner, migrations, manifest, result } = input
  const failed = result.checks.filter((check) => !check.ok)
  const report = {
    generatedAt: new Date().toISOString(),
    project: {
      ref,
      name: project.name,
      region: project.region ?? null,
      apiUrl: `https://${ref}.supabase.co`,
      dashboardUrl: `https://supabase.com/dashboard/project/${ref}`,
    },
    outletId,
    owner,
    migrations,
    observedCounts: result.observedCounts,
    expectedCounts: manifest.counts,
    journal: result.journal,
    control: result.control,
    checks: result.checks,
    ok: failed.length === 0,
  }
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return failed
}

function printHostedSummary(input: {
  project: Project
  ref: string
  outletId: string
  ownerEmail: string | null
  writeState: boolean
}): void {
  console.log('')
  console.log(`Project       : ${input.project.name} (${input.ref})`)
  console.log(`Dashboard     : https://supabase.com/dashboard/project/${input.ref}`)
  console.log(`API URL       : https://${input.ref}.supabase.co`)
  console.log(`Outlet        : ${input.outletId}`)
  console.log(`Owner         : ${input.ownerEmail ?? '-'}`)
  console.log(`Laporan       : ${REPORT_PATH}`)
  if (input.writeState) console.log(`Metadata      : ${STATE_PATH}`)
}

async function runVerifyOnly(manifest: Manifest): Promise<void> {
  const state = readState()
  const refHint = (process.env.SUPABASE_PROJECT_REF ?? state?.projectRef ?? '').trim()

  let project: Project | undefined
  if (refHint) {
    project = await api<Project>(`/v1/projects/${refHint}`)
  } else {
    const projects = await api<Project[]>('/v1/projects')
    const named = projects.filter(
      (entry) => entry.name === state?.projectName || DEFAULT_PROJECT_NAMES.includes(entry.name),
    )
    if (projects.length === 1) project = projects[0]
    else if (named.length === 1) project = named[0]
  }
  if (!project) {
    fail(
      'Mode verifikasi saja butuh project yang sudah ada. Set SUPABASE_PROJECT_REF atau jalankan ' +
        'wizard penuh sekali agar supabase/hosted.json terisi.',
    )
  }

  log(`Project       : ${project.name} (${project.ref})`)
  if (project.status !== 'ACTIVE_HEALTHY') await waitForProject(project.ref)
  ok('Project ACTIVE_HEALTHY')

  const secretKey = await findSecretKey(project.ref)
  if (!secretKey) fail('Tidak ada secret/service_role API key di project ini.')
  secrets.add(secretKey)

  const outletId =
    state?.outletId ??
    ((process.env.SUPABASE_OUTLET_ID ?? '').trim() ||
      (await restRows<{ id: string }>(project.ref, secretKey, 'outlets?select=id&limit=1'))[0]?.id)
  if (!outletId) fail('Outlet tidak ditemukan di project ini.')

  const ownerId =
    state?.ownerId ??
    ((process.env.SUPABASE_OWNER_USER_ID ?? '').trim() ||
      (await restRows<{ user_id: string }>(
        project.ref,
        secretKey,
        `outlet_members?select=user_id&role=eq.owner&outlet_id=eq.${outletId}&limit=1`,
      ))[0]?.user_id)
  if (!ownerId) fail('Owner outlet tidak ditemukan di project ini.')

  const ownerEmail = state?.ownerEmail ?? ((process.env.SUPABASE_OWNER_EMAIL ?? '').trim() || null)
  log('Mode verifikasi saja: DDL, seed, dan pembuatan project dilewati.')

  const result = await runRestChecks({ ref: project.ref, secretKey, manifest, outletId, ownerId })
  const failed = writeHostedReport({
    project,
    ref: project.ref,
    outletId,
    owner: { userId: ownerId, email: ownerEmail },
    migrations: listMigrations(),
    manifest,
    result,
  })
  printHostedSummary({ project, ref: project.ref, outletId, ownerEmail, writeState: false })

  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} pemeriksaan gagal:`)
    failed.forEach((check) => console.error(`  - ${check.name}: ${check.detail}`))
    process.exit(1)
  }
  console.log(`\n✔ Verifikasi hosted selesai: ${result.checks.length} pemeriksaan lolos.`)
}

async function main(): Promise<void> {
  const manifest = readManifest()
  if (VERIFY_ONLY) {
    await runVerifyOnly(manifest)
    return
  }

  // -------------------------------------------------------------------------
  // Profil + organisasi
  // -------------------------------------------------------------------------
  let ownerEmail = (process.env.SUPABASE_OWNER_EMAIL ?? '').trim()
  let profileStatus: number | null = null
  try {
    const profile = await api<Profile>('/v1/profile')
    if (!ownerEmail) ownerEmail = (profile.primary_email ?? '').trim()
    if (profile.primary_email) log(`Akun Supabase : ${profile.primary_email}`)
  } catch (error) {
    profileStatus = error instanceof ApiError ? error.status : null
    warn(`Profil Supabase tidak bisa dibaca: ${error instanceof Error ? error.message : String(error)}`)
  }

  let orgs: Org[]
  try {
    orgs = await api<Org[]>('/v1/organizations')
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 400)) {
      fail(
        `Token ditolak Management API (HTTP ${error.status}). Gunakan Personal Access Token akun ` +
          'Supabase → Account → Access Tokens (berawalan sbp_), bukan anon key, service_role, atau secret key project.',
      )
    }
    throw error
  }
  if (orgs.length === 0) {
    if (profileStatus === 403) {
      fail(
        'Token ini project-scoped, bukan Personal Access Token akun. Buat PAT di Supabase → Account → ' +
          'Access Tokens (berawalan sbp_), lalu jalankan ulang wizard.',
      )
    }
    fail('Akun ini tidak punya organization Supabase. Buat organization dulu di dashboard.')
  }

  let org: Org | undefined
  const orgHint = (process.env.SUPABASE_ORG_ID ?? '').trim()
  if (orgHint) {
    org = orgs.find((entry) => entry.id === orgHint || entry.slug === orgHint)
    if (!org) fail(`Organization "${orgHint}" tidak ditemukan. Pilihan: ${orgs.map((entry) => entry.slug ?? entry.id).join(', ')}`)
  } else if (orgs.length === 1) {
    org = orgs[0]
  } else {
    log('Organization:')
    orgs.forEach((entry, index) => log(`  ${index + 1}. ${entry.name} (${entry.slug ?? entry.id})`))
    const answer = await ask('Pilih nomor organization')
    const picked = orgs[Number(answer) - 1]
    if (!picked) fail('Pilihan organization tidak valid.')
    org = picked
  }
  if (!org) fail('Organization tidak bisa ditentukan.')
  log(`Organization  : ${org.name} (${org.slug ?? org.id})`)

  // -------------------------------------------------------------------------
  // Project: pakai yang ada atau buat baru
  // -------------------------------------------------------------------------
  const projects = await api<Project[]>('/v1/projects')
  const projectName = (process.env.SUPABASE_PROJECT_NAME ?? '').trim() || DEFAULT_PROJECT_NAMES[0]
  const projectRefHint = (process.env.SUPABASE_PROJECT_REF ?? '').trim()

  let project: Project | undefined
  if (projectRefHint) {
    project = projects.find((entry) => entry.ref === projectRefHint)
    if (!project) fail(`Project ref "${projectRefHint}" tidak ditemukan di akun ini.`)
  } else {
    project = projects.find((entry) => DEFAULT_PROJECT_NAMES.includes(entry.name))
    if (project) {
      log(`Project       : memakai yang sudah ada → ${project.name} (${project.ref})`)
    } else if (projects.length > 0) {
      log('Project yang sudah ada:')
      projects.forEach((entry, index) => log(`  ${index + 1}. ${entry.name} — ${entry.ref} (${entry.region ?? '?'}, ${entry.status})`))
      const answer = await ask(`Pilih nomor project, atau Enter untuk membuat "${projectName}"`)
      if (answer) {
        const picked = projects[Number(answer) - 1]
        if (!picked) fail('Pilihan project tidak valid.')
        project = picked
      }
    }
  }

  if (!project) {
    const dbPass = randomPassword()
    const regionSelection = await pickRegion(org)
    log(`Membuat project "${projectName}" di ${regionSelection.code}...`)
    const body: Record<string, unknown> = {
      name: projectName,
      db_pass: dbPass,
      region_selection: regionSelection,
      ...(org.slug ? { organization_slug: org.slug } : { organization_id: org.id }),
    }
    try {
      project = await api<Project>('/v1/projects', { method: 'POST', body: JSON.stringify(body) })
    } catch (error) {
      // Bila respons hilang tapi project sudah terbentuk, pakai yang ada.
      const after = await api<Project[]>('/v1/projects').catch(() => [] as Project[])
      const created = after.find((entry) => entry.name === projectName)
      if (!created) throw error
      project = created
    }
    ok(`Project dibuat: ${project.name} (${project.ref})`)
    warn('Password database dibuat acak dan tidak disimpan. Reset lewat Dashboard → Project Settings → Database bila perlu koneksi langsung.')
  }

  const ref = project.ref
  log(`Project ref   : ${ref}`)
  if (project.status !== 'ACTIVE_HEALTHY') await waitForProject(ref)
  ok('Project ACTIVE_HEALTHY')

  // -------------------------------------------------------------------------
  // API keys (secret hanya di memori)
  // -------------------------------------------------------------------------
  let secretKey = await findSecretKey(ref)
  if (!secretKey) {
    log('Membuat secret API key default...')
    await api(`/v1/projects/${ref}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ type: 'secret', name: 'default', secret_jwt_template: { role: 'service_role' } }),
    })
    secretKey = await findSecretKey(ref)
  }
  if (!secretKey) fail('Tidak ada secret/service_role API key di project ini.')
  secrets.add(secretKey)

  // -------------------------------------------------------------------------
  // Migration
  // -------------------------------------------------------------------------
  const migrations = listMigrations()

  const schemaExists = await restExists(ref, secretKey, 'outlets')
  if (!schemaExists) {
    for (const file of migrations) {
      const sql = readFileSync(resolve(MIGRATION_DIR, file), 'utf8')
      log(`Menjalankan migration ${file} (${sql.length.toLocaleString('id-ID')} byte)...`)
      await runSql(ref, sql)
      ok(`Migration ${file}`)
    }
  } else {
    warn('Tabel public.outlets sudah ada; migration DDL dilewati.')
    const policies = await countPolicies(ref)
    if (policies === null || policies === 0) {
      const rlsFile = migrations.find((file) => file.includes('rls')) ?? migrations[migrations.length - 1]
      const sql = readFileSync(resolve(MIGRATION_DIR, rlsFile), 'utf8')
      log(`Policy RLS belum terbaca; memastikan ${rlsFile} terpasang...`)
      try {
        await runSql(ref, sql)
        ok(`Migration ${rlsFile}`)
      } catch (error) {
        if (!/already exists/i.test(error instanceof Error ? error.message : String(error))) throw error
        warn('Policy RLS sudah ada; migration RLS dilewati.')
      }
    } else {
      log(`Policy RLS terdeteksi: ${policies}`)
    }

    // Fase 3: stream perubahan + RPC jarang ada di project yang dibuat sebelum Fase 3.
    const syncReady = await syncStreamReady(ref)
    const syncFile = migrations.find((file) => file.includes('sync_changes'))
    if (syncReady === false && syncFile) {
      log(`Stream sinkronisasi belum siap; menjalankan ${syncFile}...`)
      await runSql(ref, readFileSync(resolve(MIGRATION_DIR, syncFile), 'utf8'))
      ok(`Migration ${syncFile}`)
    } else if (syncReady) {
      log('Stream outlet_changes + RPC pull/apply_sale terdeteksi')
    }

    // Fase 2: project yang sudah punya tabel belum tentu punya bucket backup.
    const backupReady = await backupBucketReady(ref)
    const storageFile = migrations.find((file) => file.includes('backup_storage'))
    if (backupReady === false && storageFile) {
      log(`Bucket backup belum siap; menjalankan ${storageFile}...`)
      await runSql(ref, readFileSync(resolve(MIGRATION_DIR, storageFile), 'utf8'))
      ok(`Migration ${storageFile}`)
    } else if (backupReady) {
      log('Bucket pos-backups + policy storage terdeteksi')
    }
  }

  // -------------------------------------------------------------------------
  // Owner auth user
  // -------------------------------------------------------------------------
  if (!ownerEmail) {
    ownerEmail = await ask('Email owner untuk login staging')
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) fail(`Email owner tidak valid: ${ownerEmail}`)
  closePrompt()

  const owner = await ensureOwnerUser(ref, secretKey, ownerEmail)
  ok(`Owner         : ${ownerEmail} (${owner.id})`)

  // -------------------------------------------------------------------------
  // Outlet id + seed
  // -------------------------------------------------------------------------
  const previousState = readState()
  let outletId = previousState?.outletId ?? (process.env.SUPABASE_OUTLET_ID ?? '').trim()
  const existingOutlet = await restRows<{ id: string }>(ref, secretKey, 'outlets?select=id&limit=1')
  if (existingOutlet.length > 0) {
    outletId = existingOutlet[0].id
    log(`Outlet        : memakai outlet yang ada → ${outletId}`)
  } else if (!outletId) {
    outletId = randomUUID()
  }

  const seed = spawnSync(
    'bun',
    [
      'run',
      'scripts/supabase-seed.ts',
      '--outlet-id',
      outletId,
      '--owner-user-id',
      owner.id,
      '--staging',
      STAGING_DIR,
      '--out',
      SEED_DIR,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  if (seed.status !== 0) {
    fail(`db:seed gagal (exit ${seed.status}):\n${seed.stderr || seed.stdout}`)
  }
  log((seed.stdout ?? '').trim())

  const seedSql = readFileSync(resolve(SEED_DIR, 'seed.sql'), 'utf8')
  log(`Menerapkan seed (${seedSql.length.toLocaleString('id-ID')} byte)...`)
  await runSql(ref, seedSql)
  ok('Seed diterapkan')

  const verifySql = readFileSync(resolve(SEED_DIR, 'verify.sql'), 'utf8')
  await runSql(ref, verifySql)
  ok('verify.sql lolos (jumlah baris, angka kontrol, kas shift, jurnal)')

  // -------------------------------------------------------------------------
  // Verifikasi independen lewat PostgREST
  // -------------------------------------------------------------------------
  const result = await runRestChecks({ ref, secretKey, manifest, outletId, ownerId: owner.id })

  // -------------------------------------------------------------------------
  // Laporan
  // -------------------------------------------------------------------------
  const failed = writeHostedReport({
    project,
    ref,
    outletId,
    owner: { userId: owner.id, email: ownerEmail },
    migrations,
    manifest,
    result,
  })
  writeFileSync(
    STATE_PATH,
    `${JSON.stringify(
      {
        projectRef: ref,
        projectName: project.name,
        region: project.region ?? null,
        apiUrl: `https://${ref}.supabase.co`,
        outletId,
        ownerId: owner.id,
        ownerEmail,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  printHostedSummary({ project, ref, outletId, ownerEmail, writeState: true })

  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} pemeriksaan gagal:`)
    failed.forEach((check) => console.error(`  - ${check.name}: ${check.detail}`))
    process.exit(1)
  }
  console.log(`\n✔ Fase 1 hosted selesai: ${result.checks.length} pemeriksaan lolos.`)
}

async function pickRegion(org: Org): Promise<RegionSelection> {
  const requested = (process.env.SUPABASE_REGION ?? 'ap-southeast-1').trim()
  const slug = org.slug ?? org.id
  try {
    const response = await api<RegionResponse>(
      `/v1/projects/available-regions?organization_slug=${encodeURIComponent(slug)}&continent=AS`,
    )
    const specific = response.all?.specific ?? response.recommendations?.specific ?? []
    const match = specific.find((entry) => entry.code === requested)
    if (match) {
      log(`Region        : ${match.name} (${match.code}${match.provider ? `, ${match.provider}` : ''})`)
      return { type: 'specific', code: match.code, ...(match.provider ? { provider: match.provider } : {}) }
    }
    const smart = response.recommendations?.smartGroup ?? response.all?.smartGroup?.[0]
    if (smart) {
      warn(`Region ${requested} tidak tersedia; memakai smart group ${smart.code}.`)
      return { type: 'smartGroup', code: smart.code }
    }
  } catch (error) {
    warn(`Daftar region tidak bisa dibaca: ${error instanceof Error ? error.message : String(error)}`)
  }
  warn('Memakai smart group apac.')
  return { type: 'smartGroup', code: 'apac' }
}

async function waitForProject(ref: string): Promise<void> {
  const deadline = Date.now() + PROJECT_TIMEOUT_MS
  let lastStatus = ''
  while (Date.now() < deadline) {
    const project = await api<Project>(`/v1/projects/${ref}`)
    if (project.status !== lastStatus) {
      log(`Status project: ${project.status}`)
      lastStatus = project.status
    }
    if (project.status === 'ACTIVE_HEALTHY') return
    if (project.status === 'PAUSED' || project.status === 'REMOVED') {
      fail(`Project berstatus ${project.status}; periksa dashboard.`)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  fail('Project tidak ACTIVE_HEALTHY dalam 15 menit. Jalankan ulang wizard untuk melanjutkan.')
}

async function findSecretKey(ref: string): Promise<string | null> {
  const keys = await api<ApiKey[]>(`/v1/projects/${ref}/api-keys?reveal=true`)
  const secret = keys.find((entry) => entry.type === 'secret')
  if (secret?.api_key) return secret.api_key
  const legacy = keys.find((entry) => entry.type === 'legacy' && entry.name === 'service_role')
  return legacy?.api_key ?? null
}

async function runSql(ref: string, query: string): Promise<Row[]> {
  const raw = await api<unknown>(`/v1/projects/${ref}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  })
  return rowsOf(raw)
}

async function countPolicies(ref: string): Promise<number | null> {
  try {
    const rows = await runSql(
      ref,
      `select (select count(*)::int from pg_policies where schemaname = 'public') as policies, ` +
        `(select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace ` +
        `where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as rls_tables`,
    )
    if (rows.length === 0) {
      warn('Jumlah policy tidak bisa dibaca lewat Management API.')
      return null
    }
    return Number(rows[0].policies ?? 0)
  } catch (error) {
    warn(`Pemeriksaan policy gagal: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function syncStreamReady(ref: string): Promise<boolean | null> {
  try {
    const rows = await runSql(
      ref,
      `select (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name = 'outlet_changes') as tables, ` +
        `(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace ` +
        `where n.nspname = 'public' and p.proname in ('pull_changes', 'apply_sale')) as functions, ` +
        `(select count(*)::int from pg_publication where pubname = 'supabase_realtime') as realtime_publication, ` +
        `(select count(*)::int from pg_publication_tables ` +
        `where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'outlet_changes') as realtime_published`,
    )
    if (rows.length === 0) return null
    const streamReady = Number(rows[0].tables ?? 0) > 0 && Number(rows[0].functions ?? 0) >= 2
    // Di Supabase, Realtime hanya mengirim postgres_changes untuk tabel yang ikut
    // publikasi `supabase_realtime`; di Postgres biasa publikasi ini tidak ada.
    const realtimeRequired = Number(rows[0].realtime_publication ?? 0) > 0
    const realtimePublished = Number(rows[0].realtime_published ?? 0) > 0
    return streamReady && (!realtimeRequired || realtimePublished)
  } catch (error) {
    warn(`Pemeriksaan stream sinkronisasi gagal: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function syncRpcProbe(ref: string, outletId: string, ownerId: string): Promise<SyncProbe | null> {
  const payload = {
    outlet_id: outletId,
    device_id: 'hosted-probe',
    transaction: {
      id: 'tx-hosted-probe',
      number: 'PROBE-1',
      created_at: '2026-10-27T12:00:00.000Z',
      order_type: 'Takeaway',
      payment_method: 'Cash',
      subtotal: 25000,
      paid_amount: 30000,
      change_amount: 5000,
      status: 'completed',
      shift_id: 'shift-hosted-probe',
    },
    items: [{ id: 'tx-hosted-probe-item-1', menu_id: 'dada', name: 'Ayam', category: 'Paket', price: 25000, qty: 1 }],
  }
  const sale = `$syncprobe$${JSON.stringify(payload)}$syncprobe$`
  const deny = (sql: string) =>
    `do $deny$ begin begin ${sql} perform set_config('probe.denied', 'allowed', true); ` +
    `exception when others then perform set_config('probe.denied', 'denied:' || sqlstate, true); end; end $deny$;`
  // Satu transaksi, diakhiri rollback: tidak ada baris yang tertinggal di project hosted.
  const sql = `begin;
select set_config('probe.base', (select coalesce(max(seq), 0)::text from public.outlet_changes), true);
insert into public.categories (id, outlet_id, name, sort_order) values ('cat-hosted-probe', '${outletId}', 'Probe Stream', 99);
update public.categories set name = 'Probe Stream 2' where id = 'cat-hosted-probe';
update public.categories set deleted_at = now() where id = 'cat-hosted-probe';
insert into public.shifts (id, outlet_id, opened_at, closed_at, opening_float, actual_cash, status) values ('shift-hosted-probe', '${outletId}', now() - interval '2 hour', now() - interval '1 hour', 350000, 350000, 'closed');
select set_config('request.jwt.claims', '{"sub":"${ownerId}","role":"authenticated"}', true);
set local role authenticated;
select set_config('probe.page1', public.pull_changes('${outletId}'::uuid, current_setting('probe.base')::bigint, 2)::text, true);
select set_config('probe.page2', public.pull_changes('${outletId}'::uuid, (current_setting('probe.page1')::jsonb ->> 'next_seq')::bigint, 2)::text, true);
select set_config('probe.sale1', public.apply_sale(${sale}::jsonb)::text, true);
select set_config('probe.sale2', public.apply_sale(${sale}::jsonb)::text, true);
${deny("perform public.pull_changes('11111111-1111-4111-8111-111111111111'::uuid, 0, 5);")}
select set_config('probe.cross', current_setting('probe.denied', true), true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
${deny(`perform public.pull_changes('${outletId}'::uuid, 0, 5);`)}
select set_config('probe.anon', current_setting('probe.denied', true), true);
reset role;
select jsonb_build_object(
  'page1', current_setting('probe.page1', true)::jsonb,
  'page2', current_setting('probe.page2', true)::jsonb,
  'sale1', current_setting('probe.sale1', true)::jsonb,
  'sale2', current_setting('probe.sale2', true)::jsonb,
  'cross', current_setting('probe.cross', true),
  'anon', current_setting('probe.anon', true),
  'tx_rows', (select count(*)::int from public.transactions where id = 'tx-hosted-probe')
) as probe;
rollback;`
  try {
    const rows = await runSql(ref, sql)
    const raw = rows[0]?.probe
    if (!raw) return null
    const probe = (typeof raw === 'string' ? JSON.parse(raw) : raw) as SyncProbe
    // Rollback harus benar-benar bersih: tidak boleh ada sisa baris probe di hosted.
    const leftover = await runSql(
      ref,
      `select (select count(*)::int from public.categories where id = 'cat-hosted-probe') as categories, ` +
        `(select count(*)::int from public.transactions where id = 'tx-hosted-probe') as transactions, ` +
        `(select count(*)::int from public.shifts where id = 'shift-hosted-probe') as shifts`,
    )
    probe.leftover = num(leftover[0]?.categories) + num(leftover[0]?.transactions) + num(leftover[0]?.shifts)
    return probe
  } catch (error) {
    return { error: redact(error instanceof Error ? error.message : String(error)).slice(0, 500) }
  }
}

async function backupBucketReady(ref: string): Promise<boolean | null> {
  try {
    const rows = await runSql(
      ref,
      `select (select count(*)::int from storage.buckets where id = 'pos-backups') as buckets, ` +
        `(select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'pos_backups_%') as policies`,
    )
    if (rows.length === 0) return null
    return Number(rows[0].buckets ?? 0) > 0 && Number(rows[0].policies ?? 0) >= 3
  } catch (error) {
    warn(`Pemeriksaan bucket backup gagal: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function restRows<T>(ref: string, key: string, path: string): Promise<T[]> {
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const text = await response.text()
  if (!response.ok) throw new ApiError(`REST ${path} → HTTP ${response.status}: ${redact(text).slice(0, 800)}`, response.status)
  return text ? (JSON.parse(text) as T[]) : []
}

async function restExists(ref: string, key: string, table: string): Promise<boolean> {
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/${table}?select=*&limit=0`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (response.ok) return true
  if (response.status === 404) return false
  const text = await response.text()
  throw new ApiError(`REST ${table} → HTTP ${response.status}: ${redact(text).slice(0, 800)}`, response.status)
}

async function ensureOwnerUser(ref: string, key: string, email: string): Promise<AuthUser> {
  const base = `https://${ref}.supabase.co/auth/v1`
  const auth = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    const text = await response.text()
    if (!response.ok) throw new ApiError(`Auth ${path} → HTTP ${response.status}: ${redact(text).slice(0, 800)}`, response.status)
    return (text ? JSON.parse(text) : null) as T
  }

  const list = await auth<{ users?: AuthUser[] }>('/admin/users?page=1&per_page=1000')
  const found = list.users?.find((user) => (user.email ?? '').toLowerCase() === email.toLowerCase())
  if (found) return found

  const password = randomPassword()
  const created = await auth<AuthUser>('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  warn('Password owner dibuat acak dan tidak ditampilkan. Atur password lewat Dashboard → Authentication → Users → Reset password.')
  return created
}

function readState(): HostedState | null {
  if (!existsSync(STATE_PATH)) return null
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as HostedState
  } catch {
    return null
  }
}

main().catch((error) => {
  closePrompt()
  fail(error instanceof Error ? redact(error.message) : String(error))
})
