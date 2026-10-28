/**
 * Supabase PRODUCTION terpisah dari staging.
 *
 * Alur:
 *   1. buat project baru (atau lanjutkan project dengan nama/ref yang sama)
 *   2. apply migration 001 → 004 berurutan (state disimpan per file)
 *   3. buat owner di Supabase Auth (password acak; reset lewat Dashboard)
 *   4. seed HANYA master data: outlet, pengaturan, counter, akun, kategori,
 *      bahan, menu, resep, membership owner — tanpa transaksi/shift/jurnal
 *   5. verifikasi independen lewat PostgREST + SQL
 *   6. rehearsal backup terenkripsi: login owner (magic link admin), unggah,
 *      daftar, unduh, dekripsi, validasi isi, lalu hapus objek + metadata
 *
 * Token PAT hanya dibaca dari SUPABASE_ACCESS_TOKEN dan tidak pernah dicetak.
 * Jalankan lewat scripts/supabase-production.sh agar token diminta tersembunyi.
 *
 * Pemakaian:
 *   bun run supabase:production
 *   bun run supabase:production --verify-only   # tanpa create/migrate/seed
 *   bun run supabase:production --skip-rehearsal
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { initialPosStore } from '../src/domain/pos'
import { createBackupRecord, inspectBackup, serializeBackup } from '../src/lib/backup'
import {
  CLOUD_BUCKET,
  deriveCloudKey,
  downloadCloudSnapshot,
  listCloudSnapshots,
  uploadSnapshot,
  type CloudBackupConfig,
  type CloudKey,
  type CloudSession,
} from '../src/lib/cloud-backup'
import {
  buildMasterSeedArtifacts,
  MASTER_TABLES,
  OPERATIONAL_TABLES,
  type MasterSeedArtifacts,
  type MasterTableName,
} from '../src/lib/supabase-seed'
import {
  STAGING_FORMAT,
  STAGING_FORMAT_VERSION,
  STAGING_TABLES,
  type StagingManifest,
  type StagingRow,
  type StagingTableName,
} from '../src/lib/sync-staging'

const API = 'https://api.supabase.com'
const ROOT = resolve(new URL('..', import.meta.url).pathname)
const MIGRATION_DIR = resolve(ROOT, 'supabase/migrations')
const STAGING_DIR = resolve(ROOT, 'staging/supabase')
const STATE_PATH = resolve(ROOT, 'supabase/production.json')
const REPORT_PATH = resolve(ROOT, 'supabase/production-report.json')
const ARTIFACT_DIR = resolve(ROOT, 'supabase/production')

const PROJECT_NAME = (process.env.SUPABASE_PRODUCTION_PROJECT_NAME ?? 'sabana-pos-production').trim()
const REGION = (process.env.SUPABASE_PRODUCTION_REGION ?? 'ap-southeast-1').trim()
const OWNER_EMAIL = (process.env.SUPABASE_PRODUCTION_OWNER_EMAIL ?? '').trim()
const BUSINESS_NAME = (process.env.SUPABASE_PRODUCTION_BUSINESS_NAME ?? 'Sabana POS').trim()
const OUTLET_NAME = (process.env.SUPABASE_PRODUCTION_OUTLET_NAME ?? BUSINESS_NAME).trim()
const REQUEST_TIMEOUT_MS = 120_000
const PROJECT_TIMEOUT_MS = 10 * 60_000
const POLL_INTERVAL_MS = 6_000

const VERIFY_ONLY = process.argv.includes('--verify-only') || process.env.SUPABASE_PRODUCTION_VERIFY_ONLY === '1'
const SKIP_REHEARSAL = process.argv.includes('--skip-rehearsal')

type Org = { id: string; name: string; slug?: string }
type Project = {
  id: string
  ref: string
  name: string
  region?: string | null
  status: string
  organization_id?: string
  organization_slug?: string
}
type ApiKey = { api_key: string; type: string; name: string }
type AuthUser = { id: string; email?: string }
type Check = { name: string; ok: boolean; detail: string }
type Row = Record<string, unknown>

type ProductionState = {
  projectRef: string
  projectName: string
  region: string | null
  apiUrl: string
  outletId?: string
  ownerId?: string
  ownerEmail?: string
  migrations: string[]
  masterCounts?: Record<MasterTableName, number>
  updatedAt: string
}

type LoadedStaging = {
  tables: Record<StagingTableName, StagingRow[]>
  manifest: StagingManifest
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
    'SUPABASE_ACCESS_TOKEN kosong. Jalankan `bun run supabase:production` di terminal agar ' +
      'token diminta lewat input tersembunyi.',
  )
}
secrets.add(token)
if (!token.startsWith('sbp_')) {
  warn('Token tidak berawalan sbp_. Kemungkinan ini anon/service key project, bukan Personal Access Token akun.')
}

function redact(value: string): string {
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
    throw new ApiError(`${method} ${path} → HTTP ${response.status}: ${redact(text).slice(0, 1500)}`, response.status)
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

const randomPassword = (): string => randomBytes(24).toString('base64url')

function readState(): ProductionState | null {
  if (!existsSync(STATE_PATH)) return null
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as ProductionState
  } catch {
    return null
  }
}

function saveState(state: ProductionState): void {
  writeFileSync(STATE_PATH, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
}

function listMigrations(): string[] {
  return readdirSync(MIGRATION_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
}

function loadStaging(): LoadedStaging {
  const manifestPath = join(STAGING_DIR, 'manifest.json')
  if (!existsSync(manifestPath)) {
    fail(`Staging tidak ditemukan di ${STAGING_DIR}. Jalankan \`bun run sync:export\` lebih dulu.`)
  }
  let manifest: StagingManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as StagingManifest
  } catch (error) {
    fail(`Manifest staging tidak bisa dibaca: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (manifest.format !== STAGING_FORMAT || manifest.formatVersion !== STAGING_FORMAT_VERSION) {
    fail(`Format staging tidak dikenal: ${String(manifest.format)} v${String(manifest.formatVersion)}`)
  }

  const files = (manifest as unknown as { files?: { table: StagingTableName; rows: number; file: string; sha256: string }[] }).files
  if (!Array.isArray(files) || files.length === 0) fail('Manifest staging tidak memuat daftar file.')

  const tables = {} as Record<StagingTableName, StagingRow[]>
  for (const table of STAGING_TABLES) {
    const file = files.find((entry) => entry.table === table)
    if (!file) fail(`Manifest staging tidak memuat file untuk ${table}.`)
    const content = readFileSync(join(STAGING_DIR, file.file), 'utf8')
    const checksum = createHash('sha256').update(content).digest('hex')
    if (checksum !== file.sha256) fail(`Checksum ${file.file} tidak cocok. Jalankan ulang sync:export.`)
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length !== file.rows) fail(`${file.file}: ${lines.length} baris, manifest menyebut ${file.rows}.`)
    try {
      tables[table] = lines.map((line) => JSON.parse(line) as StagingRow)
    } catch (error) {
      fail(`${file.file} bukan JSONL valid: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { tables, manifest }
}

async function findSecretKey(ref: string): Promise<string | null> {
  const keys = await api<ApiKey[]>(`/v1/projects/${ref}/api-keys?reveal=true`)
  const secret = keys.find((entry) => entry.type === 'secret')
  if (secret?.api_key) return secret.api_key
  const legacy = keys.find((entry) => entry.type === 'legacy' && entry.name === 'service_role')
  return legacy?.api_key ?? null
}

async function findAnonKey(ref: string): Promise<string | null> {
  const keys = await api<ApiKey[]>(`/v1/projects/${ref}/api-keys?reveal=true`)
  const legacy = keys.find((entry) => entry.type === 'legacy' && entry.name === 'anon')
  if (legacy?.api_key) return legacy.api_key
  return keys.find((entry) => entry.type === 'publishable')?.api_key ?? null
}

async function runSql(ref: string, query: string): Promise<Row[]> {
  const raw = await api<unknown>(`/v1/projects/${ref}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  })
  return rowsOf(raw)
}

async function restRows<T>(ref: string, key: string, path: string): Promise<T[]> {
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const text = await response.text()
  if (!response.ok) throw new ApiError(`REST ${path} → HTTP ${response.status}: ${redact(text).slice(0, 900)}`, response.status)
  return text ? (JSON.parse(text) as T[]) : []
}

async function restCount(ref: string, key: string, table: string): Promise<number> {
  const rows = await restRows<Row>(ref, key, `${table}?select=*&limit=1000`)
  return rows.length
}

async function restExists(ref: string, key: string, table: string): Promise<boolean> {
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/${table}?select=*&limit=0`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (response.ok) return true
  if (response.status === 404) return false
  const text = await response.text()
  throw new ApiError(`REST ${table} → HTTP ${response.status}: ${redact(text).slice(0, 900)}`, response.status)
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
  fail(`Project belum ACTIVE_HEALTHY setelah ${Math.round(PROJECT_TIMEOUT_MS / 60_000)} menit. Jalankan ulang perintah untuk melanjutkan.`)
}

async function ensureProject(): Promise<Project> {
  const projects = await api<Project[]>('/v1/projects')
  const refHint = (process.env.SUPABASE_PRODUCTION_REF ?? '').trim()
  if (refHint) {
    const found = projects.find((entry) => entry.ref === refHint)
    if (!found) fail(`Project ref "${refHint}" tidak ditemukan di akun ini.`)
    return found
  }
  const found = projects.find((entry) => entry.name === PROJECT_NAME)
  if (found) return found

  const orgs = await api<Org[]>('/v1/organizations')
  if (orgs.length === 0) fail('Akun ini tidak punya organization Supabase.')
  const orgHint = (process.env.SUPABASE_ORG_ID ?? '').trim()
  const org = orgHint
    ? orgs.find((entry) => entry.id === orgHint || entry.slug === orgHint)
    : orgs.length === 1
      ? orgs[0]
      : undefined
  if (!org) {
    fail(`Organization harus dipilih lewat SUPABASE_ORG_ID. Pilihan: ${orgs.map((entry) => entry.slug ?? entry.id).join(', ')}`)
  }

  const dbPass = randomPassword()
  secrets.add(dbPass)
  log(`Membuat project production "${PROJECT_NAME}" di ${REGION}...`)
  const body: Record<string, unknown> = {
    name: PROJECT_NAME,
    db_pass: dbPass,
    region_selection: { type: 'specific', code: REGION },
    ...(org.slug ? { organization_slug: org.slug } : { organization_id: org.id }),
  }
  try {
    const project = await api<Project>('/v1/projects', { method: 'POST', body: JSON.stringify(body) })
    ok(`Project dibuat: ${project.name} (${project.ref})`)
    return project
  } catch (error) {
    const after = await api<Project[]>('/v1/projects').catch(() => [] as Project[])
    const created = after.find((entry) => entry.name === PROJECT_NAME)
    if (created) return created
    if (error instanceof ApiError && (error.status === 402 || error.status === 403)) {
      fail(
        `Project production tidak bisa dibuat (HTTP ${error.status}). Plan Free membatasi jumlah project aktif; ` +
          'pause/hapus project staging yang tidak dipakai atau upgrade plan, lalu jalankan ulang. ' +
          `Pesan: ${redact(error.message)}`,
      )
    }
    throw error
  }
}

async function ensureOwnerUser(ref: string, key: string, email: string): Promise<{ user: AuthUser; created: boolean }> {
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
    if (!response.ok) throw new ApiError(`Auth ${path} → HTTP ${response.status}: ${redact(text).slice(0, 900)}`, response.status)
    return (text ? JSON.parse(text) : null) as T
  }

  const list = await auth<{ users?: AuthUser[] }>('/admin/users?page=1&per_page=1000')
  const existing = list.users?.find((user) => (user.email ?? '').toLowerCase() === email.toLowerCase())
  if (existing) return { user: existing, created: false }

  const password = randomPassword()
  secrets.add(password)
  const created = await auth<AuthUser>('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  return { user: created, created: true }
}

async function ownerSession(ref: string, anonKey: string, secretKey: string, email: string, ownerId: string): Promise<CloudSession> {
  const admin = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`https://${ref}.supabase.co/auth/v1${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    const text = await response.text()
    if (!response.ok) throw new ApiError(`Auth admin ${path} → HTTP ${response.status}: ${redact(text).slice(0, 700)}`, response.status)
    return (text ? JSON.parse(text) : null) as T
  }

  const link = await admin<{
    hashed_token?: string
    email_otp?: string
    action_link?: string
    properties?: { hashed_token?: string; email_otp?: string }
  }>('/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  const tokenHash = link.hashed_token ?? link.properties?.hashed_token
  const emailOtp = link.email_otp ?? link.properties?.email_otp
  let actionToken: string | null = null
  if (link.action_link) {
    try {
      actionToken = new URL(link.action_link).searchParams.get('token')
    } catch {
      actionToken = null
    }
  }
  const candidates: Array<Record<string, string>> = []
  if (tokenHash) candidates.push({ token_hash: tokenHash })
  if (emailOtp) candidates.push({ token: emailOtp })
  if (actionToken) candidates.push({ token: actionToken })
  if (candidates.length === 0) fail('Auth admin tidak mengembalikan token magic link untuk rehearsal.')

  const errors: string[] = []
  for (const candidate of candidates) {
    const response = await fetch(`https://${ref}.supabase.co/auth/v1/verify`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', ...candidate }),
    })
    const text = await response.text()
    if (response.ok) {
      const session = JSON.parse(text) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        user?: { id?: string; email?: string }
      }
      if (!session.access_token || !session.refresh_token) {
        errors.push(`verify tanpa token sesi (${Object.keys(session).join(',')})`)
        continue
      }
      secrets.add(session.access_token)
      secrets.add(session.refresh_token)
      return {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: Date.now() + Math.max(60, session.expires_in ?? 3600) * 1000,
        email: session.user?.email ?? email,
        userId: session.user?.id ?? ownerId,
      }
    }
    errors.push(`verify HTTP ${response.status}: ${redact(text).slice(0, 300)}`)
  }
  fail(`Sesi owner untuk rehearsal tidak bisa dibuat. ${errors.join(' | ')}`)
}

async function runProductionChecks(input: {
  ref: string
  secretKey: string
  anonKey: string
  outletId: string
  ownerId: string
  expected: Record<MasterTableName, number>
}): Promise<Check[]> {
  const { ref, secretKey, anonKey, outletId, ownerId, expected } = input
  const checks: Check[] = []
  const addCheck = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, ok: pass, detail })
    if (pass) ok(`${name}: ${detail}`)
    else console.error(`✖ ${name}: ${detail}`)
  }

  for (const table of MASTER_TABLES) {
    const count = await restCount(ref, secretKey, table)
    addCheck(`Master ${table}`, count === expected[table], `${count} / ${expected[table]}`)
  }
  for (const table of OPERATIONAL_TABLES) {
    const count = await restCount(ref, secretKey, table)
    addCheck(`Kosong ${table}`, count === 0, `${count} baris`)
  }

  const members = await restRows<Row>(ref, secretKey, `outlet_members?select=role,user_id,outlet_id&outlet_id=eq.${outletId}`)
  addCheck(
    'Owner membership',
    members.length === 1 && members[0]?.role === 'owner' && members[0]?.user_id === ownerId,
    `${members.length} baris • role=${String(members[0]?.role ?? '-')}`,
  )

  const counters = await restRows<Row>(ref, secretKey, `outlet_counters?select=next_transaction_number&outlet_id=eq.${outletId}`)
  addCheck('Nomor struk mulai 1', num(counters[0]?.next_transaction_number) === 1, `next=${String(counters[0]?.next_transaction_number ?? '-')}`)

  const settings = await restRows<Row>(ref, secretKey, `outlet_settings?select=outlet_id,business_name,paper_width&outlet_id=eq.${outletId}`)
  addCheck('Pengaturan outlet', settings.length === 1, `${settings.length} baris • ${String(settings[0]?.business_name ?? '-')}`)

  const sync = await runSql(
    ref,
    `select (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('pull_changes', 'apply_sale')) as functions, ` +
      `(select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'outlet_changes') as realtime_published, ` +
      `(select count(*)::int from public.outlet_changes where outlet_id = '${outletId}'::uuid) as changes, ` +
      `(select count(*)::int from pg_policies where schemaname = 'public') as policies, ` +
      `(select count(*)::int from storage.buckets where id = 'pos-backups' and public = false) as private_buckets, ` +
      `(select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'pos_backups_%') as storage_policies`,
  )
  const syncRow = sync[0] ?? {}
  addCheck('RPC sinkronisasi', num(syncRow.functions) >= 2, `${num(syncRow.functions)} fungsi`)
  addCheck('Realtime outlet_changes', num(syncRow.realtime_published) > 0, `${num(syncRow.realtime_published)} publikasi`)
  addCheck('Stream perubahan master', num(syncRow.changes) > 0, `${num(syncRow.changes)} baris`)
  addCheck('Policy RLS', num(syncRow.policies) > 20, `${num(syncRow.policies)} policy`)
  addCheck('Bucket backup privat', num(syncRow.private_buckets) === 1 && num(syncRow.storage_policies) >= 4, `${num(syncRow.private_buckets)} bucket • ${num(syncRow.storage_policies)} policy`)

  // Anon tidak boleh melihat data outlet meski RLS aktif.
  try {
    const response = await fetch(`https://${ref}.supabase.co/rest/v1/outlets?select=id&limit=5`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = await response.text()
    const rows = response.ok ? (JSON.parse(body) as unknown[]) : []
    // Migration 001 mencabut seluruh grant anon, jadi 401/403 adalah penolakan
    // yang benar. Bila kelak grant dibuka, 200 dengan nol baris juga aman.
    const denied = response.status === 401 || response.status === 403 || (response.ok && Array.isArray(rows) && rows.length === 0)
    addCheck('Anon ditolak membaca outlet', denied, `HTTP ${response.status} • ${rows.length} baris`)
  } catch (error) {
    addCheck('Anon ditolak membaca outlet', false, error instanceof Error ? error.message : String(error))
  }

  return checks
}

function objectUrl(ref: string, path: string): string {
  const encoded = path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `https://${ref}.supabase.co/storage/v1/object/${encodeURIComponent(CLOUD_BUCKET)}/${encoded}`
}

async function decodeJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text
  }
}

async function rehearseBackup(input: {
  ref: string
  anonKey: string
  secretKey: string
  owner: { id: string; email: string }
  outletId: string
  businessName: string
}): Promise<Check[]> {
  const { ref, anonKey, secretKey, owner, outletId, businessName } = input
  const checks: Check[] = []
  const addCheck = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, ok: pass, detail })
    if (pass) ok(`${name}: ${detail}`)
    else console.error(`✖ ${name}: ${detail}`)
  }

  const session = await ownerSession(ref, anonKey, secretKey, owner.email, owner.id)
  addCheck('Login owner (magic link)', Boolean(session.accessToken), `${session.email} • userId=${session.userId}`)

  const passphrase = `rehearsal-${randomBytes(18).toString('base64url')}`
  secrets.add(passphrase)
  const key: CloudKey = await deriveCloudKey(passphrase)
  const config: CloudBackupConfig = {
    enabled: true,
    projectUrl: `https://${ref}.supabase.co`,
    anonKey,
    outletId,
    bucket: CLOUD_BUCKET,
    key,
    updatedAt: new Date().toISOString(),
  }

  const createdAt = new Date().toISOString()
  const store = {
    ...initialPosStore,
    nextTransactionNumber: 1,
    settings: {
      ...initialPosStore.settings,
      businessName,
      outletName: businessName,
    },
  }
  const record = createBackupRecord(store, 'manual', createdAt)
  const plaintext = serializeBackup(record)
  let storagePath: string | null = null
  let snapshotId: string | null = null
  let cleanupObject = false
  let cleanupMetadata = false

  try {
    const uploaded = await uploadSnapshot(record, { config, session, deviceId: 'production-rehearsal' })
    storagePath = uploaded.path
    snapshotId = uploaded.snapshotId
    cleanupObject = true
    cleanupMetadata = true
    addCheck('Unggah backup terenkripsi', uploaded.sizeBytes > 0, `${uploaded.sizeBytes} byte • checksum ${uploaded.checksum.slice(0, 12)}`)

    const snapshots = await listCloudSnapshots(config, session, { limit: 10 })
    const listed = snapshots.find((entry) => entry.id === uploaded.snapshotId)
    addCheck('Metadata snapshot terdaftar', Boolean(listed), `${snapshots.length} snapshot terlihat`)

    const downloaded = await downloadCloudSnapshot(config, session, uploaded.path, { key })
    addCheck('Unduh + dekripsi', downloaded.text === plaintext && downloaded.checksum === uploaded.checksum, `${downloaded.text.length} karakter • checksum cocok=${downloaded.checksum === uploaded.checksum}`)

    const inspected = inspectBackup(downloaded.text)
    addCheck(
      'Restore validasi skema',
      inspected.ok && inspected.store.menus.length === record.store.menus.length,
      inspected.ok ? `${inspected.store.menus.length} menu • ${inspected.store.ingredients.length} bahan` : inspected.error,
    )

    const anonymous = await fetch(objectUrl(ref, uploaded.path), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    addCheck('Snapshot privat dari anon', [400, 401, 403, 404].includes(anonymous.status), `HTTP ${anonymous.status}`)
  } catch (error) {
    addCheck('Rehearsal backup/restore', false, error instanceof Error ? redact(error.message) : String(error))
  } finally {
    if (cleanupObject && storagePath) {
      try {
        // Endpoint bulk adalah yang dipakai supabase-js `remove`; fallback ke
        // endpoint objek tunggal bila server menolak bentuk body ini.
        let deleted = await fetch(`https://${ref}.supabase.co/storage/v1/object/${encodeURIComponent(CLOUD_BUCKET)}`, {
          method: 'DELETE',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefixes: [storagePath] }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (!deleted.ok) {
          deleted = await fetch(objectUrl(ref, storagePath), {
            method: 'DELETE',
            headers: { apikey: anonKey, Authorization: `Bearer ${session.accessToken}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          })
        }
        addCheck('Hapus objek rehearsal', deleted.ok || deleted.status === 404, `HTTP ${deleted.status}`)
      } catch (error) {
        addCheck('Hapus objek rehearsal', false, error instanceof Error ? redact(error.message) : String(error))
      }
    }
    if (cleanupMetadata && snapshotId) {
      try {
        const deleted = await fetch(
          `https://${ref}.supabase.co/rest/v1/outlet_snapshots?id=eq.${encodeURIComponent(snapshotId)}`,
          {
            method: 'DELETE',
            headers: {
              apikey: secretKey,
              Authorization: `Bearer ${secretKey}`,
              Prefer: 'return=minimal',
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        )
        addCheck('Hapus metadata rehearsal', deleted.ok, `HTTP ${deleted.status}`)
      } catch (error) {
        addCheck('Hapus metadata rehearsal', false, error instanceof Error ? redact(error.message) : String(error))
      }
    }
    try {
      const remaining = await restCount(ref, secretKey, 'outlet_snapshots')
      addCheck('Tidak ada sisa snapshot rehearsal', remaining === 0, `${remaining} baris`)
      if (storagePath) {
        // storage.objects adalah sumber kebenaran; GET objek bisa masih 200 dari
        // cache tepi sesaat setelah DELETE, jadi jangan dipakai sebagai gate.
        const escaped = storagePath.replace(/'/g, "''")
        const objects = await runSql(
          ref,
          `select count(*)::int as objects from storage.objects where bucket_id = '${CLOUD_BUCKET}' and name = '${escaped}';`,
        )
        const objectCount = num(objects[0]?.objects)
        const cached = await fetch(`${objectUrl(ref, storagePath)}?cacheBust=${Date.now()}`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${session.accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        addCheck(
          'Objek rehearsal sudah hilang',
          objectCount === 0,
          `${objectCount} baris storage.objects • GET cache ${cached.status}`,
        )
      }
    } catch (error) {
      addCheck('Pembersihan rehearsal', false, error instanceof Error ? redact(error.message) : String(error))
    }
  }

  return checks
}

function writeReport(input: {
  ok: boolean
  project: Project
  owner: { id: string; email: string }
  outletId: string
  migrations: string[]
  seed: MasterSeedArtifacts
  checks: Check[]
}): void {
  const report = {
    ok: input.ok,
    generatedAt: new Date().toISOString(),
    project: {
      ref: input.project.ref,
      name: input.project.name,
      region: input.project.region ?? REGION,
      apiUrl: `https://${input.project.ref}.supabase.co`,
      dashboard: `https://supabase.com/dashboard/project/${input.project.ref}`,
    },
    owner: { id: input.owner.id, email: input.owner.email, passwordReset: 'Dashboard → Authentication → Users → Reset password' },
    outletId: input.outletId,
    migrations: input.migrations,
    seed: { tables: MASTER_TABLES, counts: input.seed.counts, excluded: OPERATIONAL_TABLES },
    checks: input.checks,
    passed: input.checks.filter((check) => check.ok).length,
    failed: input.checks.filter((check) => !check.ok).length,
  }
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const previous = readState()
  let state: ProductionState | null = previous
  let project: Project | null = null

  if (VERIFY_ONLY) {
    const ref = (process.env.SUPABASE_PRODUCTION_REF ?? state?.projectRef ?? '').trim()
    if (!ref) fail('Mode --verify-only butuh supabase/production.json atau SUPABASE_PRODUCTION_REF.')
    project = await api<Project>(`/v1/projects/${ref}`)
    log(`Mode verifikasi saja: ${project.name} (${project.ref})`)
  } else {
    project = await ensureProject()
    const ref = project.ref
    state = state && state.projectRef === ref
      ? state
      : {
          projectRef: ref,
          projectName: project.name,
          region: project.region ?? REGION,
          apiUrl: `https://${ref}.supabase.co`,
          migrations: [],
          updatedAt: new Date().toISOString(),
        }
    saveState(state)
    log(`Project ref   : ${ref}`)
    if (project.status !== 'ACTIVE_HEALTHY') await waitForProject(ref)
    ok('Project ACTIVE_HEALTHY')
  }
  if (!project) fail('Project production tidak bisa ditentukan.')

  const ref = project.ref
  let secretKey = await findSecretKey(ref)
  if (!secretKey) {
    log('Membuat secret API key default...')
    await api(`/v1/projects/${ref}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ type: 'secret', name: 'default', secret_jwt_template: { role: 'service_role' } }),
    })
    secretKey = await findSecretKey(ref)
  }
  if (!secretKey) fail('Tidak ada secret/service_role API key di project production.')
  secrets.add(secretKey)
  const anonKey = await findAnonKey(ref)
  if (!anonKey) fail('Tidak ada anon/publishable API key di project production.')
  secrets.add(anonKey)

  const staging = loadStaging()
  const ownerEmail = OWNER_EMAIL || (state?.ownerEmail ?? '') || (await api<{ primary_email?: string }>('/v1/profile')).primary_email || ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) fail(`Email owner production tidak valid: "${ownerEmail}"`)

  let owner: { user: AuthUser; created: boolean } | null = null
  let outletId = state?.outletId ?? (process.env.SUPABASE_OUTLET_ID ?? '').trim()

  if (!VERIFY_ONLY) {
    const migrations = listMigrations()
    const applied = new Set(state?.migrations ?? [])
    const schemaExists = await restExists(ref, secretKey, 'outlets')
    if (schemaExists && applied.size === 0) {
      fail(
        'Project ini sudah memiliki schema public.outlets tetapi state migration production kosong. ' +
          'Gunakan project baru, atau isi supabase/production.json dengan daftar migration yang sudah terpasang.',
      )
    }
    if (!schemaExists && migrations.length === 0) fail('Tidak ada file migration di supabase/migrations.')

    for (const file of migrations) {
      if (applied.has(file)) {
        log(`Migration ${file}: sudah tercatat, dilewati.`)
        continue
      }
      const sql = readFileSync(resolve(MIGRATION_DIR, file), 'utf8')
      log(`Menjalankan migration ${file} (${sql.length.toLocaleString('id-ID')} byte)...`)
      await runSql(ref, sql)
      applied.add(file)
      state = {
        ...(state as ProductionState),
        migrations: [...applied],
      }
      saveState(state)
      ok(`Migration ${file}`)
    }

    owner = await ensureOwnerUser(ref, secretKey, ownerEmail)
    if (owner.created) {
      warn('Password owner dibuat acak dan tidak ditampilkan. Reset lewat Dashboard → Authentication → Users → Reset password.')
    }
    ok(`Owner         : ${ownerEmail} (${owner.user.id})`)

    const existingOutlet = await restRows<{ id: string }>(ref, secretKey, 'outlets?select=id&limit=1')
    if (existingOutlet.length > 0) {
      outletId = existingOutlet[0].id
      log(`Outlet        : memakai outlet yang ada → ${outletId}`)
    } else if (!outletId) {
      outletId = randomUUID()
    }

    const seed = buildMasterSeedArtifacts(staging.tables, {
      outletId,
      ownerUserId: owner.user.id,
      outletName: OUTLET_NAME,
      businessName: BUSINESS_NAME,
      paperWidth: 80,
      copies: 1,
    })
    mkdirSync(ARTIFACT_DIR, { recursive: true })
    writeFileSync(resolve(ARTIFACT_DIR, 'seed.sql'), seed.seedSql, 'utf8')
    writeFileSync(resolve(ARTIFACT_DIR, 'verify.sql'), seed.verifySql, 'utf8')
    log(`Seed master   : ${ARTIFACT_DIR}/seed.sql (${seed.seedSql.split('\n').length} baris, tanpa transaksi/shift/jurnal)`)
    await runSql(ref, seed.seedSql)
    ok('Seed master diterapkan')
    await runSql(ref, seed.verifySql)
    ok('verify.sql master lolos (operasional kosong, nomor struk 1)')

    state = {
      ...(state as ProductionState),
      outletId,
      ownerId: owner.user.id,
      ownerEmail,
      masterCounts: seed.counts,
    }
    saveState(state)
  }

  const finalState = state as ProductionState
  if (!finalState.outletId || !finalState.ownerId) fail('State production belum lengkap; jalankan tanpa --verify-only lebih dulu.')
  if (!owner) {
    owner = { user: { id: finalState.ownerId, email: finalState.ownerEmail ?? ownerEmail }, created: false }
  }

  const seed = buildMasterSeedArtifacts(staging.tables, {
    outletId: finalState.outletId,
    ownerUserId: finalState.ownerId,
    outletName: OUTLET_NAME,
    businessName: BUSINESS_NAME,
    paperWidth: 80,
    copies: 1,
  })

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  writeFileSync(resolve(ARTIFACT_DIR, 'seed.sql'), seed.seedSql, 'utf8')
  writeFileSync(resolve(ARTIFACT_DIR, 'verify.sql'), seed.verifySql, 'utf8')

  const checks = await runProductionChecks({
    ref,
    secretKey,
    anonKey,
    outletId: finalState.outletId,
    ownerId: finalState.ownerId,
    expected: finalState.masterCounts ?? seed.counts,
  })

  if (!SKIP_REHEARSAL) {
    const rehearsal = await rehearseBackup({
      ref,
      anonKey,
      secretKey,
      owner: { id: finalState.ownerId, email: finalState.ownerEmail ?? ownerEmail },
      outletId: finalState.outletId,
      businessName: BUSINESS_NAME,
    })
    checks.push(...rehearsal)
  } else {
    warn('Rehearsal backup/restore dilewati (--skip-rehearsal).')
  }

  const failed = checks.filter((check) => !check.ok)
  writeReport({
    ok: failed.length === 0,
    project,
    owner: { id: finalState.ownerId, email: finalState.ownerEmail ?? ownerEmail },
    outletId: finalState.outletId,
    migrations: finalState.migrations,
    seed,
    checks,
  })

  log('')
  log(`Laporan       : ${REPORT_PATH}`)
  log(`State         : ${STATE_PATH}`)
  log(`Project       : ${project.name} (${ref})`)
  log(`Dashboard     : https://supabase.com/dashboard/project/${ref}`)
  log(`API URL       : https://${ref}.supabase.co`)
  log(`Outlet        : ${finalState.outletId}`)
  log(`Owner         : ${finalState.ownerEmail ?? ownerEmail}`)
  log(`Migration     : ${finalState.migrations.join(', ') || '(tidak ada)'}`)
  log(`Pemeriksaan   : ${checks.length - failed.length}/${checks.length} lolos`)

  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} pemeriksaan gagal:`)
    failed.forEach((check) => console.error(`  - ${check.name}: ${check.detail}`))
    process.exit(1)
  }
  console.log(`\n✔ Production siap: ${checks.length} pemeriksaan lolos, termasuk rehearsal backup/restore.`)
}

main().catch((error) => {
  fail(error instanceof Error ? redact(error.message) : String(error))
})
