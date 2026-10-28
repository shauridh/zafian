/**
 * Fase 2 — cloud backup satu arah.
 *
 * Backup JSON lokal dienkripsi di perangkat (PBKDF2-SHA256 → AES-GCM 256),
 * lalu diunggah ke bucket privat `pos-backups` Supabase Storage. Metadata
 * snapshot dicatat di `public.outlet_snapshots`. Aplikasi tetap membaca dan
 * menulis IndexedDB; cloud hanya salinan, bukan sumber kebenaran.
 *
 * Semua fungsi jaringan menerima `fetchImpl` agar bisa diuji tanpa cloud.
 * Jalur kasir memakai `uploadBackupQuietly()` yang tidak pernah melempar error.
 */

import { serializeBackup, type BackupReason, type BackupRecord } from './backup'
import { readJson, writeJson } from './storage'

export const CLOUD_BACKUP_FORMAT = 'sabana-pos-cloud-backup'
export const CLOUD_BACKUP_FORMAT_VERSION = 1
export const CLOUD_BUCKET = 'pos-backups'
export const CLOUD_CONFIG_KEY = 'cloud:config'
export const CLOUD_SESSION_KEY = 'cloud:session'
export const CLOUD_STATUS_KEY = 'cloud:status'
export const DEFAULT_PBKDF2_ITERATIONS = 210_000
export const CLOUD_SNAPSHOT_TABLE = 'outlet_snapshots'

export type CloudKey = {
  /** Base64 kunci AES-256 hasil turunan PBKDF2. */
  material: string
  /** Base64 salt PBKDF2. */
  salt: string
  iterations: number
}

export type CloudBackupConfig = {
  enabled: boolean
  projectUrl: string
  /** Anon key Supabase — publik menurut desain, bukan service role key. */
  anonKey: string
  outletId: string
  bucket: string
  key: CloudKey | null
  updatedAt: string
}

export type CloudSession = {
  accessToken: string
  refreshToken: string
  /** Epoch milidetik kedaluwarsa access token. */
  expiresAt: number
  email: string
  userId: string
}

export type CloudStatusState = 'disabled' | 'pending-setup' | 'idle' | 'uploading' | 'ok' | 'error'

export type CloudStatus = {
  state: CloudStatusState
  /** `createdAt|reason` snapshot terakhir yang dicoba, untuk deduplikasi. */
  lastSnapshotKey?: string
  lastAttemptAt?: string
  lastSuccessAt?: string
  lastError?: string
  lastPath?: string
  lastChecksum?: string
}

export type CloudSnapshotEnvelope = {
  format: typeof CLOUD_BACKUP_FORMAT
  formatVersion: typeof CLOUD_BACKUP_FORMAT_VERSION
  algorithm: 'AES-GCM'
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  /** SHA-256 hex dari plaintext JSON, diverifikasi setelah dekripsi. */
  checksum: string
  schemaVersion: number
  createdAt: string
  reason: BackupReason
  outletId: string
  deviceId: string
  plaintextBytes: number
  ciphertext: string
}

export type CloudSnapshotRow = {
  id: string
  createdAt: string
  reason: BackupReason
  checksum: string
  storagePath: string
  sizeBytes: number
  schemaVersion: number
}

export type CloudErrorCode = 'disabled' | 'setup' | 'auth' | 'crypto' | 'network' | 'server' | 'malformed'

export class CloudBackupError extends Error {
  code: CloudErrorCode
  status?: number
  constructor(code: CloudErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'CloudBackupError'
    this.code = code
    this.status = status
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type CloudDeps = {
  fetchImpl?: FetchLike
  now?: () => Date
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function resolveFetch(deps: CloudDeps = {}): FetchLike {
  const candidate = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
  if (!candidate) throw new CloudBackupError('network', 'Runtime ini tidak menyediakan fetch untuk backup cloud.')
  return candidate
}

function nowIso(deps: CloudDeps = {}): string {
  return (deps.now?.() ?? new Date()).toISOString()
}

/* -------------------------------------------------------------------------- */
/* Base64 & kriptografi                                                       */
/* -------------------------------------------------------------------------- */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Salin ke ArrayBuffer agar tipe BufferSource aman di semua versi TypeScript. */
function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function cryptoRef(): Crypto {
  const candidate = typeof crypto === 'undefined' ? null : crypto
  if (!candidate?.subtle) throw new CloudBackupError('crypto', 'Web Crypto (crypto.subtle) tidak tersedia. Buka aplikasi lewat HTTPS atau localhost.')
  return candidate
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  cryptoRef().getRandomValues(bytes)
  return bytes
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input
  const digest = await cryptoRef().subtle.digest('SHA-256', bufferSource(bytes))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Turunkan kunci AES-256 dari frasa sandi; salt/iterasi dipakai ulang saat restore. */
export async function deriveCloudKey(
  passphrase: string,
  options: { salt?: string; iterations?: number } = {},
): Promise<CloudKey> {
  const trimmed = passphrase.trim()
  if (trimmed.length < 8) throw new CloudBackupError('setup', 'Frasa sandi backup cloud minimal 8 karakter.')
  const salt = options.salt ?? bytesToBase64(randomBytes(16))
  const iterations = Math.max(100_000, Math.trunc(options.iterations ?? DEFAULT_PBKDF2_ITERATIONS))
  const subtle = cryptoRef().subtle
  const baseKey = await subtle.importKey('raw', bufferSource(encoder.encode(trimmed)), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bufferSource(base64ToBytes(salt)), iterations }, baseKey, 256)
  return { material: bytesToBase64(new Uint8Array(bits)), salt, iterations }
}

async function importCloudKey(key: CloudKey): Promise<CryptoKey> {
  const raw = base64ToBytes(key.material)
  if (raw.length !== 32) throw new CloudBackupError('crypto', 'Material kunci backup cloud tidak valid.')
  return cryptoRef().subtle.importKey('raw', bufferSource(raw), 'AES-GCM', true, ['encrypt', 'decrypt'])
}

/** Enkripsi plaintext backup menjadi envelope JSON yang siap diunggah. */
export async function encryptSnapshot(
  text: string,
  meta: { schemaVersion: number; createdAt: string; reason: BackupReason; outletId: string; deviceId: string },
  key: CloudKey,
): Promise<CloudSnapshotEnvelope> {
  const aesKey = await importCloudKey(key)
  const iv = randomBytes(12)
  const ciphertext = await cryptoRef().subtle.encrypt({ name: 'AES-GCM', iv: bufferSource(iv) }, aesKey, bufferSource(encoder.encode(text)))
  return {
    format: CLOUD_BACKUP_FORMAT,
    formatVersion: CLOUD_BACKUP_FORMAT_VERSION,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: key.iterations,
    salt: key.salt,
    iv: bytesToBase64(iv),
    checksum: await sha256Hex(text),
    schemaVersion: meta.schemaVersion,
    createdAt: meta.createdAt,
    reason: meta.reason,
    outletId: meta.outletId,
    deviceId: meta.deviceId,
    plaintextBytes: encoder.encode(text).length,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

function parseEnvelope(value: CloudSnapshotEnvelope | string): CloudSnapshotEnvelope {
  let parsed: unknown
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value
  } catch (error) {
    throw new CloudBackupError('malformed', error instanceof Error ? `Snapshot bukan JSON valid: ${error.message}` : 'Snapshot bukan JSON valid.')
  }
  const record = parsed as Partial<CloudSnapshotEnvelope> | null
  if (!record || typeof record !== 'object') throw new CloudBackupError('malformed', 'Snapshot cloud bukan objek envelope.')
  if (record.format !== CLOUD_BACKUP_FORMAT) throw new CloudBackupError('malformed', 'Format snapshot cloud tidak dikenal.')
  if (record.formatVersion !== CLOUD_BACKUP_FORMAT_VERSION) throw new CloudBackupError('malformed', `Versi snapshot cloud ${String(record.formatVersion)} tidak didukung.`)
  if (record.algorithm !== 'AES-GCM' || record.kdf !== 'PBKDF2-SHA256') throw new CloudBackupError('malformed', 'Algoritma snapshot cloud tidak didukung.')
  if (typeof record.ciphertext !== 'string' || typeof record.iv !== 'string' || typeof record.salt !== 'string') throw new CloudBackupError('malformed', 'Snapshot cloud kehilangan data enkripsi.')
  if (typeof record.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(record.checksum)) throw new CloudBackupError('malformed', 'Checksum snapshot cloud tidak valid.')
  if (typeof record.iterations !== 'number' || !Number.isFinite(record.iterations)) throw new CloudBackupError('malformed', 'Parameter KDF snapshot cloud tidak valid.')
  return record as CloudSnapshotEnvelope
}

async function decryptWithKey(envelope: CloudSnapshotEnvelope, key: CloudKey): Promise<string> {
  const aesKey = await importCloudKey(key)
  let plaintext: ArrayBuffer
  try {
    plaintext = await cryptoRef().subtle.decrypt(
      { name: 'AES-GCM', iv: bufferSource(base64ToBytes(envelope.iv)) },
      aesKey,
      bufferSource(base64ToBytes(envelope.ciphertext)),
    )
  } catch {
    throw new CloudBackupError('crypto', 'Snapshot tidak bisa didekripsi. Frasa sandi salah atau file rusak.')
  }
  const text = decoder.decode(new Uint8Array(plaintext))
  const checksum = await sha256Hex(text)
  if (checksum !== envelope.checksum) throw new CloudBackupError('crypto', 'Checksum snapshot tidak cocok; file diubah atau rusak.')
  return text
}

/** Dekripsi memakai kunci tersimpan (perangkat yang sudah dikonfigurasi). */
export async function decryptSnapshot(envelope: CloudSnapshotEnvelope | string, key: CloudKey): Promise<string> {
  return decryptWithKey(parseEnvelope(envelope), key)
}

/** Dekripsi di perangkat baru: frasa sandi + salt dari envelope. */
export async function decryptSnapshotWithPassphrase(envelope: CloudSnapshotEnvelope | string, passphrase: string): Promise<string> {
  const parsed = parseEnvelope(envelope)
  const key = await deriveCloudKey(passphrase, { salt: parsed.salt, iterations: parsed.iterations })
  return decryptWithKey(parsed, key)
}

/* -------------------------------------------------------------------------- */
/* Konfigurasi, sesi, dan status                                              */
/* -------------------------------------------------------------------------- */

export function emptyCloudConfig(): CloudBackupConfig {
  return { enabled: false, projectUrl: '', anonKey: '', outletId: '', bucket: CLOUD_BUCKET, key: null, updatedAt: '' }
}

export function normalizeProjectUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
}

export type CloudConfigInput = {
  projectUrl: string
  anonKey: string
  outletId: string
  email: string
  password: string
  passphrase: string
  passphraseConfirm: string
}

/** Validasi form aktivasi; mengembalikan pesan error pertama atau null. */
export function validateCloudConfigInput(input: CloudConfigInput): string | null {
  const projectUrl = normalizeProjectUrl(input.projectUrl)
  if (!/^https?:\/\//.test(projectUrl)) return 'URL project harus diawali https:// (atau http://localhost saat uji lokal).'
  if (projectUrl.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(projectUrl)) return 'Gunakan HTTPS untuk project selain localhost.'
  if (!input.anonKey.trim()) return 'Anon key Supabase wajib diisi (bukan service role key).'
  if (/service_role/i.test(input.anonKey)) return 'Jangan memakai service role key di aplikasi; gunakan anon key.'
  if (!isUuid(input.outletId)) return 'ID outlet harus UUID dari tabel outlets.'
  if (!/^[^@\s]+@[^@\s]+$/.test(input.email.trim())) return 'Email akun pemilik tidak valid.'
  if (input.password.length < 6) return 'Kata sandi akun minimal 6 karakter.'
  if (input.passphrase.trim().length < 8) return 'Frasa sandi enkripsi minimal 8 karakter.'
  if (input.passphrase !== input.passphraseConfirm) return 'Konfirmasi frasa sandi tidak sama.'
  return null
}

let configCache: CloudBackupConfig | null | undefined
let sessionCache: CloudSession | null | undefined

export async function loadCloudConfig(force = false): Promise<CloudBackupConfig | null> {
  if (!force && configCache !== undefined) return configCache
  const raw = await readJson<Partial<CloudBackupConfig>>(CLOUD_CONFIG_KEY)
  configCache = raw ? {
    enabled: Boolean(raw.enabled),
    projectUrl: typeof raw.projectUrl === 'string' ? raw.projectUrl : '',
    anonKey: typeof raw.anonKey === 'string' ? raw.anonKey : '',
    outletId: typeof raw.outletId === 'string' ? raw.outletId : '',
    bucket: typeof raw.bucket === 'string' && raw.bucket ? raw.bucket : CLOUD_BUCKET,
    key: raw.key && typeof raw.key.material === 'string' && typeof raw.key.salt === 'string'
      ? { material: raw.key.material, salt: raw.key.salt, iterations: Number(raw.key.iterations) || DEFAULT_PBKDF2_ITERATIONS }
      : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  } : null
  return configCache
}

export async function saveCloudConfig(config: CloudBackupConfig): Promise<void> {
  const next = { ...config, projectUrl: normalizeProjectUrl(config.projectUrl), bucket: config.bucket || CLOUD_BUCKET }
  await writeJson(CLOUD_CONFIG_KEY, next)
  configCache = next
}

export async function loadCloudSession(): Promise<CloudSession | null> {
  if (sessionCache !== undefined) return sessionCache
  const raw = await readJson<Partial<CloudSession>>(CLOUD_SESSION_KEY)
  sessionCache = raw && typeof raw.accessToken === 'string' && typeof raw.refreshToken === 'string'
    ? {
        accessToken: raw.accessToken,
        refreshToken: raw.refreshToken,
        expiresAt: Number(raw.expiresAt) || 0,
        email: typeof raw.email === 'string' ? raw.email : '',
        userId: typeof raw.userId === 'string' ? raw.userId : '',
      }
    : null
  return sessionCache
}

export async function saveCloudSession(session: CloudSession): Promise<void> {
  await writeJson(CLOUD_SESSION_KEY, session)
  sessionCache = session
}

export async function clearCloudSession(): Promise<void> {
  await writeJson(CLOUD_SESSION_KEY, null)
  sessionCache = null
}

let status: CloudStatus = { state: 'disabled' }
const listeners = new Set<(value: CloudStatus) => void>()

export function getCloudStatus(): CloudStatus {
  return status
}

export function subscribeCloudStatus(listener: (value: CloudStatus) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function publishStatus(next: CloudStatus): CloudStatus {
  status = next
  for (const listener of listeners) listener(next)
  void writeJson(CLOUD_STATUS_KEY, next).catch((error: unknown) => {
    console.warn('Status backup cloud tidak bisa disimpan', error)
  })
  return next
}

/** Muat status terakhir dan tentukan state awal berdasarkan konfigurasi. */
export async function hydrateCloudStatus(options: { config?: CloudBackupConfig | null } = {}): Promise<CloudStatus> {
  const stored = await readJson<Partial<CloudStatus>>(CLOUD_STATUS_KEY)
  const config = options.config === undefined ? await loadCloudConfig() : options.config
  const session = await loadCloudSession()
  if (!config?.enabled) {
    status = { ...(stored as CloudStatus | undefined), state: 'disabled', lastError: undefined }
    return status
  }
  if (!config.key || !isUuid(config.outletId)) {
    status = { ...(stored as CloudStatus | undefined), state: 'pending-setup', lastError: 'Frasa sandi atau ID outlet belum diatur.' }
    return status
  }
  status = {
    ...(stored as CloudStatus | undefined),
    state: stored?.state === 'ok' ? 'ok' : session ? 'idle' : 'pending-setup',
    lastError: session ? stored?.lastError : 'Masuk dengan akun pemilik Supabase untuk mengaktifkan backup cloud.',
  }
  return status
}

export function describeCloudError(error: unknown): string {
  if (error instanceof CloudBackupError) return error.message
  if (error instanceof Error) return error.message
  return 'Kesalahan backup cloud tidak dikenal.'
}

/* -------------------------------------------------------------------------- */
/* Supabase Auth + REST                                                       */
/* -------------------------------------------------------------------------- */

function baseUrl(config: Pick<CloudBackupConfig, 'projectUrl'>): string {
  const url = normalizeProjectUrl(config.projectUrl)
  if (!url) throw new CloudBackupError('setup', 'URL project Supabase belum diisi.')
  return url
}

function authHeaders(config: Pick<CloudBackupConfig, 'anonKey'>, accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: config.anonKey }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return headers
}

type AuthPayload = { access_token?: string; refresh_token?: string; expires_in?: number; user?: { id?: string; email?: string }; error_description?: string; msg?: string; message?: string; error?: string }

async function authTokenRequest(
  config: Pick<CloudBackupConfig, 'projectUrl' | 'anonKey'>,
  body: Record<string, string>,
  deps: CloudDeps,
): Promise<CloudSession> {
  const fetchImpl = resolveFetch(deps)
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl(config)}/auth/v1/token?grant_type=${body.grant_type}`, {
      method: 'POST',
      headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new CloudBackupError('network', `Tidak bisa menghubungi Supabase Auth: ${error instanceof Error ? error.message : String(error)}`)
  }
  const payload = await response.json().catch(() => ({})) as AuthPayload
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    const detail = payload.error_description ?? payload.msg ?? payload.message ?? payload.error ?? `HTTP ${response.status}`
    throw new CloudBackupError('auth', `Login Supabase gagal: ${detail}`, response.status)
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: (deps.now?.() ?? new Date()).getTime() + (payload.expires_in ?? 3600) * 1000,
    email: payload.user?.email ?? '',
    userId: payload.user?.id ?? '',
  }
}

/** Login email+sandi akun pemilik Supabase (bukan service role). */
export async function signInWithPassword(
  config: Pick<CloudBackupConfig, 'projectUrl' | 'anonKey'>,
  email: string,
  password: string,
  deps: CloudDeps = {},
): Promise<CloudSession> {
  const session = await authTokenRequest(config, { grant_type: 'password', email: email.trim(), password }, deps)
  if (!session.email) session.email = email.trim()
  return session
}

export async function refreshCloudSession(
  config: Pick<CloudBackupConfig, 'projectUrl' | 'anonKey'>,
  session: CloudSession,
  deps: CloudDeps = {},
): Promise<CloudSession> {
  const refreshed = await authTokenRequest(config, { grant_type: 'refresh_token', refresh_token: session.refreshToken }, deps)
  return {
    ...refreshed,
    email: refreshed.email || session.email,
    userId: refreshed.userId || session.userId,
  }
}

async function ensureSession(
  config: CloudBackupConfig,
  session: CloudSession | null,
  deps: CloudDeps,
): Promise<CloudSession> {
  if (!session) throw new CloudBackupError('auth', 'Belum masuk ke Supabase. Masuk dengan akun pemilik di panel Backup cloud.')
  const nowMs = (deps.now?.() ?? new Date()).getTime()
  // Perbarui 60 detik sebelum kedaluwarsa agar unggahan tidak gagal di tengah jalan.
  if (session.expiresAt - 60_000 > nowMs) return session
  const refreshed = await refreshCloudSession(config, session, deps)
  await saveCloudSession(refreshed)
  return refreshed
}

/* -------------------------------------------------------------------------- */
/* Path snapshot                                                              */
/* -------------------------------------------------------------------------- */

export function snapshotStoragePath(outletId: string, createdAt: string, reason: BackupReason, checksum: string): string {
  if (!isUuid(outletId)) throw new CloudBackupError('setup', 'ID outlet belum valid; snapshot tidak bisa diberi path.')
  const stamp = createdAt.replace(/\.\d+Z$/, 'Z').replace(/[:.]/g, '-')
  const safeReason = (['daily', 'before-shift-close', 'manual', 'legacy'] as const).includes(reason) ? reason : 'manual'
  return `${outletId}/${stamp}-${safeReason}-${checksum.slice(0, 12)}.json.enc`
}

function objectUrl(config: CloudBackupConfig, path: string): string {
  const encoded = path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `${baseUrl(config)}/storage/v1/object/${encodeURIComponent(config.bucket || CLOUD_BUCKET)}/${encoded}`
}

function snapshotKey(record: Pick<BackupRecord, 'createdAt' | 'reason'>): string {
  return `${record.createdAt}|${record.reason}`
}

/* -------------------------------------------------------------------------- */
/* Unggah                                                                     */
/* -------------------------------------------------------------------------- */

export type CloudUploadResult = {
  path: string
  checksum: string
  sizeBytes: number
  createdAt: string
  reason: BackupReason
  schemaVersion: number
  snapshotId: string
}

export type UploadSnapshotOptions = CloudDeps & {
  config: CloudBackupConfig
  session: CloudSession | null
  deviceId?: string
  /** Lewati penulisan metadata (dipakai uji yang hanya memeriksa storage). */
  skipMetadata?: boolean
}

/** Enkripsi lalu unggah satu backup. Melempar CloudBackupError bila gagal. */
export async function uploadSnapshot(record: BackupRecord, options: UploadSnapshotOptions): Promise<CloudUploadResult> {
  const { config } = options
  if (!config.enabled) throw new CloudBackupError('disabled', 'Backup cloud belum diaktifkan.')
  if (!config.key) throw new CloudBackupError('setup', 'Frasa sandi backup cloud belum diatur.')
  if (!isUuid(config.outletId)) throw new CloudBackupError('setup', 'ID outlet Supabase belum diisi.')
  const fetchImpl = resolveFetch(options)
  const session = await ensureSession(config, options.session, options)
  const text = serializeBackup(record)
  const checksum = await sha256Hex(text)
  const envelope = await encryptSnapshot(text, {
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt,
    reason: record.reason,
    outletId: config.outletId,
    deviceId: options.deviceId?.trim() || record.store.sync.deviceId || 'device-local',
  }, config.key)
  const body = JSON.stringify(envelope)
  const path = snapshotStoragePath(config.outletId, record.createdAt, record.reason, checksum)

  let uploadResponse: Response
  try {
    uploadResponse = await fetchImpl(objectUrl(config, path), {
      method: 'POST',
      headers: {
        ...authHeaders(config, session.accessToken),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        // Konten sama → checksum sama → path sama; upsert membuat retry idempoten.
        'x-upsert': 'true',
      },
      body,
    })
  } catch (error) {
    throw new CloudBackupError('network', `Unggah snapshot gagal: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text().catch(() => '')
    throw new CloudBackupError('server', `Storage menolak snapshot (HTTP ${uploadResponse.status}). ${detail.slice(0, 180)}`.trim(), uploadResponse.status)
  }

  const snapshotId = `snap-${checksum.slice(0, 32)}`
  if (!options.skipMetadata) {
    const row = {
      id: snapshotId,
      outlet_id: config.outletId,
      schema_version: record.schemaVersion,
      reason: record.reason,
      created_at: record.createdAt,
      device_id: envelope.deviceId,
      checksum,
      storage_path: path,
      size_bytes: new TextEncoder().encode(body).length,
    }
    let metaResponse: Response
    try {
      metaResponse = await fetchImpl(`${baseUrl(config)}/rest/v1/${CLOUD_SNAPSHOT_TABLE}?on_conflict=id`, {
        method: 'POST',
        headers: {
          ...authHeaders(config, session.accessToken),
          'Content-Type': 'application/json',
          // Grant tabel hanya insert; duplikat diabaikan agar retry tidak menggandakan baris.
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(row),
      })
    } catch (error) {
      throw new CloudBackupError('network', `Metadata snapshot gagal dikirim: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!metaResponse.ok) {
      const detail = await metaResponse.text().catch(() => '')
      // Bersihkan objek agar storage tidak menyimpan snapshot tanpa metadata.
      await fetchImpl(objectUrl(config, path), { method: 'DELETE', headers: authHeaders(config, session.accessToken) })
        .catch((error: unknown) => { console.warn('Gagal membersihkan snapshot tanpa metadata', error) })
      throw new CloudBackupError('server', `Metadata snapshot ditolak (HTTP ${metaResponse.status}). ${detail.slice(0, 180)}`.trim(), metaResponse.status)
    }
  }

  return {
    path,
    checksum,
    sizeBytes: new TextEncoder().encode(body).length,
    createdAt: record.createdAt,
    reason: record.reason,
    schemaVersion: record.schemaVersion,
    snapshotId,
  }
}

let inFlight: Promise<CloudStatus> | null = null

/**
 * Dipanggil setelah backup lokal (harian / sebelum tutup shift). Tidak pernah
 * melempar error dan tidak menahan alur kasir; hasilnya masuk ke status yang
 * ditampilkan di ikon sync dan panel Backup cloud.
 */
export async function uploadBackupQuietly(
  record: BackupRecord,
  options: CloudDeps & { config?: CloudBackupConfig | null; session?: CloudSession | null } = {},
): Promise<CloudStatus> {
  if (inFlight) return inFlight
  inFlight = (async (): Promise<CloudStatus> => {
    const config = options.config === undefined ? await loadCloudConfig() : options.config
    const attemptAt = nowIso(options)
    if (!config?.enabled) {
      return publishStatus({ ...status, state: 'disabled', lastAttemptAt: attemptAt, lastError: undefined })
    }
    if (!config.key || !isUuid(config.outletId)) {
      return publishStatus({
        ...status,
        state: 'pending-setup',
        lastAttemptAt: attemptAt,
        lastError: 'Backup cloud belum lengkap: atur ID outlet dan frasa sandi di panel Backup cloud.',
      })
    }
    const session = options.session === undefined ? await loadCloudSession() : options.session
    if (!session) {
      return publishStatus({
        ...status,
        state: 'pending-setup',
        lastAttemptAt: attemptAt,
        lastError: 'Masuk dengan akun pemilik Supabase untuk mengaktifkan backup cloud.',
      })
    }
    const key = snapshotKey(record)
    if (status.state === 'ok' && status.lastSnapshotKey === key) return status

    publishStatus({ ...status, state: 'uploading', lastAttemptAt: attemptAt, lastError: undefined, lastSnapshotKey: key })
    try {
      const result = await uploadSnapshot(record, { config, session, fetchImpl: options.fetchImpl, now: options.now })
      return publishStatus({
        state: 'ok',
        lastSnapshotKey: key,
        lastAttemptAt: attemptAt,
        lastSuccessAt: nowIso(options),
        lastPath: result.path,
        lastChecksum: result.checksum,
      })
    } catch (error) {
      return publishStatus({
        ...status,
        state: 'error',
        lastSnapshotKey: key,
        lastAttemptAt: attemptAt,
        lastError: describeCloudError(error),
      })
    }
  })().finally(() => { inFlight = null })
  return inFlight
}

/* -------------------------------------------------------------------------- */
/* Daftar & unduh                                                             */
/* -------------------------------------------------------------------------- */

type SnapshotApiRow = {
  id?: string
  created_at?: string
  reason?: string
  checksum?: string
  storage_path?: string
  size_bytes?: number
  schema_version?: number
}

export async function listCloudSnapshots(
  config: CloudBackupConfig,
  session: CloudSession | null,
  deps: CloudDeps & { limit?: number } = {},
): Promise<CloudSnapshotRow[]> {
  if (!isUuid(config.outletId)) throw new CloudBackupError('setup', 'ID outlet Supabase belum diisi.')
  const fetchImpl = resolveFetch(deps)
  const active = await ensureSession(config, session, deps)
  const limit = Math.min(50, Math.max(1, deps.limit ?? 20))
  const query = `select=id,created_at,reason,checksum,storage_path,size_bytes,schema_version&outlet_id=eq.${encodeURIComponent(config.outletId)}&order=created_at.desc&limit=${limit}`
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl(config)}/rest/v1/${CLOUD_SNAPSHOT_TABLE}?${query}`, {
      method: 'GET',
      headers: authHeaders(config, active.accessToken),
    })
  } catch (error) {
    throw new CloudBackupError('network', `Daftar snapshot tidak bisa dimuat: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new CloudBackupError('server', `Daftar snapshot ditolak (HTTP ${response.status}). ${detail.slice(0, 180)}`.trim(), response.status)
  }
  const rows = await response.json().catch(() => []) as SnapshotApiRow[]
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.storage_path === 'string' && row.storage_path)
    .map((row) => ({
      id: String(row.id ?? ''),
      createdAt: String(row.created_at ?? ''),
      reason: (['daily', 'before-shift-close', 'manual', 'legacy'] as const).includes(row.reason as BackupReason) ? row.reason as BackupReason : 'manual',
      checksum: String(row.checksum ?? ''),
      storagePath: String(row.storage_path),
      sizeBytes: Number(row.size_bytes) || 0,
      schemaVersion: Number(row.schema_version) || 0,
    }))
}

export type DownloadedSnapshot = {
  text: string
  checksum: string
  envelope: CloudSnapshotEnvelope
}

/** Unduh envelope lalu dekripsi dengan kunci perangkat atau frasa sandi. */
export async function downloadCloudSnapshot(
  config: CloudBackupConfig,
  session: CloudSession | null,
  storagePath: string,
  options: CloudDeps & ({ key: CloudKey } | { passphrase: string }),
): Promise<DownloadedSnapshot> {
  const fetchImpl = resolveFetch(options)
  const active = await ensureSession(config, session, options)
  let response: Response
  try {
    response = await fetchImpl(objectUrl(config, storagePath), {
      method: 'GET',
      headers: authHeaders(config, active.accessToken),
    })
  } catch (error) {
    throw new CloudBackupError('network', `Snapshot tidak bisa diunduh: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new CloudBackupError('server', `Unduhan snapshot ditolak (HTTP ${response.status}). ${detail.slice(0, 180)}`.trim(), response.status)
  }
  const raw = await response.text()
  const envelope = parseEnvelope(raw)
  const text = 'key' in options
    ? await decryptWithKey(envelope, options.key)
    : await decryptSnapshotWithPassphrase(envelope, options.passphrase)
  return { text, checksum: envelope.checksum, envelope }
}

/** Matikan backup cloud: sesi dihapus, konfigurasi disimpan nonaktif. */
export async function disableCloudBackup(config: CloudBackupConfig | null): Promise<void> {
  if (config) await saveCloudConfig({ ...config, enabled: false, updatedAt: new Date().toISOString() })
  await clearCloudSession()
  publishStatus({ state: 'disabled' })
}
