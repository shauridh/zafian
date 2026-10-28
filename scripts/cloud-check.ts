/**
 * Uji Fase 2 (cloud backup satu arah) tanpa menyentuh Supabase.
 *
 * Semua jaringan memakai fetch tiruan sehingga tidak ada project/kredensial
 * nyata yang dipakai. Fokus: enkripsi & checksum, pemilihan jalur unggah,
 * idempotensi retry, fallback diagnostik, serta restore dari snapshot cloud.
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  clear() { this.map.clear() }
  getItem(key: string) { return this.map.get(key) ?? null }
  key(index: number) { return [...this.map.keys()][index] ?? null }
  removeItem(key: string) { this.map.delete(key) }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })

const storage = await import('../src/lib/storage')
await storage.initStorage()

const { inspectBackupValue, createBackupRecord, serializeBackup } = await import('../src/lib/backup')
const { normalizeStore } = await import('../src/lib/schema')
const cloud = await import('../src/lib/cloud-backup')
const { mergeSupabaseDefaults, supabaseEnvDefaults } = await import('../src/lib/env')

let checks = 0
let failures = 0
function check(name: string, condition: boolean, detail = '') {
  checks += 1
  if (condition) console.log(`PASS ${name}`)
  else { failures += 1; console.error(`FAIL ${name} ${detail}`) }
}

async function expectThrow(name: string, run: () => Promise<unknown>, includes?: string) {
  checks += 1
  try {
    await run()
    failures += 1
    console.error(`FAIL ${name} (tidak melempar error)`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (includes && !message.toLowerCase().includes(includes.toLowerCase())) {
      failures += 1
      console.error(`FAIL ${name} (pesan "${message}" tidak memuat "${includes}")`)
      return
    }
    console.log(`PASS ${name}`)
  }
}

const fixture = inspectBackupValue(JSON.parse(readFileSync(join(process.cwd(), 'scripts/fixtures/supabase-seed.json'), 'utf8')) as unknown)
if (!fixture.ok) {
  console.error(`Fixture tidak valid: ${fixture.error}`)
  process.exit(1)
}
const store = normalizeStore(fixture.store)
const outletId = '471d3f1c-1ad0-4f88-a35c-7f9f6e968926'
const record = createBackupRecord(store, 'daily', '2026-10-27T08:43:11.000Z')
const plaintext = serializeBackup(record)

const passphrase = 'sabana-frasa-sandi-uji'
const key = await cloud.deriveCloudKey(passphrase, { salt: 'bmFzaWJha2FyLXVqaS0xNg==' })

const projectUrl = 'https://contoh-uji.supabase.co'
const anonKey = 'anon-key-uji'
const accessToken = 'access-token-uji'

const session: cloud.CloudSession = {
  accessToken,
  refreshToken: 'refresh-token-uji',
  expiresAt: Date.now() + 3_600_000,
  email: 'owner@example.test',
  userId: 'owner-user-uji',
}

const config: cloud.CloudBackupConfig = {
  enabled: true,
  projectUrl,
  anonKey,
  outletId,
  bucket: cloud.CLOUD_BUCKET,
  key,
  updatedAt: '2026-10-27T08:00:00.000Z',
}

/* -------------------------------------------------------------------------- */
/* Fetch tiruan                                                               */
/* -------------------------------------------------------------------------- */

type Recorded = { url: string; method: string; headers: Record<string, string>; body: string }
let calls: Recorded[] = []
type Responder = (call: Recorded) => Response
let responder: Responder = () => new Response('{}', { status: 200 })

function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) headers[name] = String(value)
  const call: Recorded = { url: input, method: init.method ?? 'GET', headers, body: typeof init.body === 'string' ? init.body : '' }
  calls.push(call)
  const result = responder(call)
  if (result instanceof Error) return Promise.reject(result)
  return Promise.resolve(result)
}

function reset(next: Responder = () => new Response('{}', { status: 200 })) {
  calls = []
  responder = next
}

const deps = { fetchImpl: fakeFetch }

/* -------------------------------------------------------------------------- */
/* 1. Enkripsi & checksum                                                     */
/* -------------------------------------------------------------------------- */

const keyAgain = await cloud.deriveCloudKey(passphrase, { salt: key.salt, iterations: key.iterations })
check('kunci turunan deterministic untuk salt yang sama', keyAgain.material === key.material)
const otherKey = await cloud.deriveCloudKey(passphrase, { salt: 'c2FsdC1sYWluLXVqaS0xNg==' })
check('salt berbeda menghasilkan kunci berbeda', otherKey.material !== key.material)
check('material kunci 256-bit (base64 44 karakter)', key.material.length === 44, `${key.material.length}`)
check('iterasi PBKDF2 memenuhi batas minimum', key.iterations >= 100_000, `${key.iterations}`)
await expectThrow('frasa sandi pendek ditolak', () => cloud.deriveCloudKey('pendek'), 'minimal 8')

const envelope = await cloud.encryptSnapshot(plaintext, {
  schemaVersion: record.schemaVersion,
  createdAt: record.createdAt,
  reason: record.reason,
  outletId,
  deviceId: 'device-uji',
}, key)

check('format envelope sesuai kontrak', envelope.format === cloud.CLOUD_BACKUP_FORMAT && envelope.formatVersion === cloud.CLOUD_BACKUP_FORMAT_VERSION)
check('algoritma envelope AES-GCM + PBKDF2', envelope.algorithm === 'AES-GCM' && envelope.kdf === 'PBKDF2-SHA256')
check('checksum envelope = SHA-256 plaintext', envelope.checksum === await cloud.sha256Hex(plaintext))
const decodedCipher = atob(envelope.ciphertext)
check('ciphertext tidak memuat plaintext', !envelope.ciphertext.includes('SABANA') && !decodedCipher.includes(record.store.businessName))
check('ukuran plaintext tercatat', envelope.plaintextBytes === new TextEncoder().encode(plaintext).length)

const decrypted = await cloud.decryptSnapshot(envelope, key)
check('dekripsi dengan kunci perangkat mengembalikan plaintext identik', decrypted === plaintext)

const decryptedFreshDevice = await cloud.decryptSnapshotWithPassphrase(JSON.stringify(envelope), passphrase)
check('dekripsi di perangkat baru memakai frasa sandi + salt envelope', decryptedFreshDevice === plaintext)

await expectThrow('frasa sandi salah tidak bisa mendekripsi', () => cloud.decryptSnapshotWithPassphrase(envelope, 'frasa-sandi-keliru'), 'tidak bisa didekripsi')

const tamperedChecksum = { ...envelope, checksum: 'a'.repeat(64) }
await expectThrow('checksum yang diubah ditolak', () => cloud.decryptSnapshot(tamperedChecksum, key), 'checksum')

const tamperedCipher = { ...envelope, ciphertext: btoa('{"dipalsukan":true}') }
await expectThrow('ciphertext yang diubah gagal autentikasi', () => cloud.decryptSnapshot(tamperedCipher, key), 'tidak bisa didekripsi')

await expectThrow('envelope format asing ditolak', () => cloud.decryptSnapshot({ ...envelope, format: 'lain' } as unknown as typeof envelope, key), 'tidak dikenal')

/* -------------------------------------------------------------------------- */
/* 2. Path snapshot                                                           */
/* -------------------------------------------------------------------------- */

const path = cloud.snapshotStoragePath(outletId, record.createdAt, record.reason, envelope.checksum)
check('path dimulai dengan outlet UUID', path.startsWith(`${outletId}/`), path)
check('path berakhiran .json.enc dan memuat alasan', path.endsWith('.json.enc') && path.includes('daily'), path)
check('path memuat potongan checksum (idempoten untuk konten sama)', path.includes(envelope.checksum.slice(0, 12)))
check('path tidak memuat traversal', !path.includes('..'))
await expectThrow('outlet bukan UUID ditolak saat membentuk path', () => Promise.resolve(cloud.snapshotStoragePath('outlet-local', record.createdAt, 'daily', envelope.checksum)), 'outlet')

/* -------------------------------------------------------------------------- */
/* 3. Auth Supabase                                                           */
/* -------------------------------------------------------------------------- */

reset((call) => {
  if (call.url.includes('/auth/v1/token?grant_type=password')) {
    return new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: 'refresh-baru',
      expires_in: 3600,
      user: { id: 'owner-user-uji', email: 'owner@example.test' },
    }), { status: 200 })
  }
  return new Response('{}', { status: 200 })
})
const signedIn = await cloud.signInWithPassword({ projectUrl, anonKey }, 'owner@example.test', 'rahasia-uji', deps)
check('login memakai grant_type=password', calls[0]?.url === `${projectUrl}/auth/v1/token?grant_type=password`, calls[0]?.url)
check('login mengirim apikey anon', calls[0]?.headers.apikey === anonKey)
check('login mengirim email + sandi di body', JSON.parse(calls[0]?.body ?? '{}').email === 'owner@example.test' && JSON.parse(calls[0]?.body ?? '{}').password === 'rahasia-uji')
check('sesi memuat token, refresh, dan masa berlaku', signedIn.accessToken === accessToken && signedIn.refreshToken === 'refresh-baru' && signedIn.expiresAt > Date.now())

reset(() => new Response(JSON.stringify({ error_description: 'Invalid login credentials' }), { status: 400 }))
await expectThrow('login gagal menampilkan pesan Supabase', () => cloud.signInWithPassword({ projectUrl, anonKey }, 'owner@example.test', 'salah', deps), 'Invalid login credentials')

reset((call) => call.url.includes('grant_type=refresh_token')
  ? new Response(JSON.stringify({ access_token: 'access-segar', refresh_token: 'refresh-segar', expires_in: 3600 }), { status: 200 })
  : new Response('[]', { status: 200 }))
const refreshedRows = await cloud.listCloudSnapshots(config, { ...session, expiresAt: Date.now() - 1000 }, deps)
check('sesi kedaluwarsa diperbarui via refresh_token', JSON.parse(calls[0]?.body ?? '{}').grant_type === 'refresh_token')
check('daftar snapshot memakai token hasil refresh', calls[1]?.headers.Authorization === 'Bearer access-segar', calls[1]?.headers.Authorization)
check('daftar snapshot kosong terbaca sebagai array', Array.isArray(refreshedRows) && refreshedRows.length === 0)

/* -------------------------------------------------------------------------- */
/* 4. Unggah                                                                  */
/* -------------------------------------------------------------------------- */

reset((call) => {
  if (call.method === 'POST' && call.url.includes('/storage/v1/object/')) return new Response('{}', { status: 200 })
  if (call.method === 'POST' && call.url.includes('/rest/v1/outlet_snapshots')) return new Response('', { status: 201 })
  return new Response('{}', { status: 200 })
})

const uploaded = await cloud.uploadSnapshot(record, { config, session, fetchImpl: fakeFetch })
const storageCall = calls.find((call) => call.url.includes('/storage/v1/object/'))
const metaCall = calls.find((call) => call.url.includes('/rest/v1/outlet_snapshots'))
check('unggahan mengirim tepat satu objek storage', calls.filter((call) => call.url.includes('/storage/v1/object/')).length === 1)
check('URL storage memakai bucket privat pos-backups', storageCall?.url === `${projectUrl}/storage/v1/object/${cloud.CLOUD_BUCKET}/${path}`, storageCall?.url)
check('unggahan memakai Bearer access token + apikey', storageCall?.headers.Authorization === `Bearer ${accessToken}` && storageCall?.headers.apikey === anonKey)
check('unggahan memakai x-upsert agar retry idempoten', storageCall?.headers['x-upsert'] === 'true')
check('body unggahan adalah envelope terenkripsi', (() => {
  const body = JSON.parse(storageCall?.body ?? '{}') as cloud.CloudSnapshotEnvelope
  return body.format === cloud.CLOUD_BACKUP_FORMAT && body.ciphertext.length > 0 && body.checksum === uploaded.checksum
})())
check('metadata ditulis ke outlet_snapshots dengan on_conflict=id', metaCall?.url === `${projectUrl}/rest/v1/outlet_snapshots?on_conflict=id`, metaCall?.url)
check('metadata memakai Prefer ignore-duplicates', (metaCall?.headers.Prefer ?? '').includes('ignore-duplicates'), metaCall?.headers.Prefer)
const row = JSON.parse(metaCall?.body ?? '{}') as Record<string, unknown>
check('baris metadata memuat outlet, checksum, path, ukuran, skema, alasan', row.outlet_id === outletId
  && row.checksum === uploaded.checksum
  && row.storage_path === uploaded.path
  && Number(row.size_bytes) > 0
  && row.schema_version === record.schemaVersion
  && row.reason === record.reason
  && row.device_id === record.store.sync.deviceId, JSON.stringify(row))

reset((call) => {
  if (call.url.includes('/storage/v1/object/') && call.method === 'POST') return new Response('{}', { status: 200 })
  if (call.url.includes('/rest/v1/outlet_snapshots')) return new Response(JSON.stringify({ message: 'permission denied' }), { status: 403 })
  return new Response('{}', { status: 200 })
})
await expectThrow('metadata ditolak → unggahan gagal jelas', () => cloud.uploadSnapshot(record, { config, session, fetchImpl: fakeFetch }), 'Metadata snapshot ditolak')
check('objek dibersihkan saat metadata gagal', calls.some((call) => call.method === 'DELETE' && call.url.includes('/storage/v1/object/')))

reset(() => new Response(JSON.stringify({ message: 'bucket not found' }), { status: 404 }))
await expectThrow('storage menolak → pesan HTTP disertakan', () => cloud.uploadSnapshot(record, { config, session, fetchImpl: fakeFetch }), '404')

/* -------------------------------------------------------------------------- */
/* 5. Jalur kasir: quiet upload & status                                     */
/* -------------------------------------------------------------------------- */

reset()
const disabledStatus = await cloud.uploadBackupQuietly(record, { config: { ...config, enabled: false }, fetchImpl: fakeFetch })
check('konfigurasi nonaktif → status disabled tanpa jaringan', disabledStatus.state === 'disabled' && calls.length === 0)

reset()
const noSessionStatus = await cloud.uploadBackupQuietly(record, { config, session: null, fetchImpl: fakeFetch })
check('tanpa sesi → pending-setup dengan petunjuk login', noSessionStatus.state === 'pending-setup' && (noSessionStatus.lastError ?? '').toLowerCase().includes('masuk'), noSessionStatus.lastError)
check('tanpa sesi tidak ada panggilan jaringan', calls.length === 0)

reset()
const noKeyStatus = await cloud.uploadBackupQuietly(record, { config: { ...config, key: null }, session, fetchImpl: fakeFetch })
check('tanpa kunci → pending-setup, bukan crash', noKeyStatus.state === 'pending-setup' && calls.length === 0)

reset((call) => {
  if (call.url.includes('/storage/v1/object/')) return new Response('{}', { status: 200 })
  if (call.url.includes('/rest/v1/outlet_snapshots')) return new Response('', { status: 201 })
  return new Response('{}', { status: 200 })
})
const okStatus = await cloud.uploadBackupQuietly(record, { config, session, fetchImpl: fakeFetch })
check('unggahan sukses → status ok + checksum tersimpan', okStatus.state === 'ok' && okStatus.lastChecksum === envelope.checksum, JSON.stringify(okStatus))
check('status sukses ditampilkan untuk ikon sync', cloud.getCloudStatus().state === 'ok')

const callsAfterSuccess = calls.length
const repeated = await cloud.uploadBackupQuietly(record, { config, session, fetchImpl: fakeFetch })
check('snapshot yang sama tidak diunggah dua kali', repeated.state === 'ok' && calls.length === callsAfterSuccess, `${calls.length} vs ${callsAfterSuccess}`)

const otherRecord = createBackupRecord(store, 'before-shift-close', '2026-10-27T09:10:00.000Z')
reset(() => new Response(JSON.stringify({ message: 'storage down' }), { status: 500 }))
const failureStatus = await cloud.uploadBackupQuietly(otherRecord, { config, session, fetchImpl: fakeFetch })
check('kegagalan unggah tidak melempar ke kasir', failureStatus.state === 'error')
check('status gagal memuat pesan diagnostik', (failureStatus.lastError ?? '').length > 0)

const retryRecord = createBackupRecord(store, 'daily', '2026-10-28T08:00:00.000Z')
reset(() => { throw new Error('offline total') })
const offlineStatus = await cloud.uploadBackupQuietly(retryRecord, { config, session, fetchImpl: fakeFetch })
check('jaringan mati → status error, bukan exception', offlineStatus.state === 'error' && (offlineStatus.lastError ?? '').includes('offline total'), offlineStatus.lastError)

reset((call) => {
  if (call.url.includes('/storage/v1/object/')) return new Response('{}', { status: 200 })
  if (call.url.includes('/rest/v1/outlet_snapshots')) return new Response('', { status: 201 })
  return new Response('{}', { status: 200 })
})
const retriedStatus = await cloud.uploadBackupQuietly(retryRecord, { config, session, fetchImpl: fakeFetch })
check('backup otomatis dicoba ulang setelah jaringan pulih', retriedStatus.state === 'ok', JSON.stringify(retriedStatus))

/* -------------------------------------------------------------------------- */
/* 6. Daftar & restore                                                        */
/* -------------------------------------------------------------------------- */

reset((call) => {
  if (call.url.includes('/rest/v1/outlet_snapshots')) {
    return new Response(JSON.stringify([{
      id: uploaded.snapshotId,
      created_at: record.createdAt,
      reason: record.reason,
      checksum: uploaded.checksum,
      storage_path: uploaded.path,
      size_bytes: 2048,
      schema_version: record.schemaVersion,
    }]), { status: 200 })
  }
  if (call.url.includes('/storage/v1/object/')) return new Response(JSON.stringify(envelope), { status: 200 })
  return new Response('{}', { status: 200 })
})

const rows = await cloud.listCloudSnapshots(config, session, { fetchImpl: fakeFetch })
check('daftar snapshot memetakan kolom REST ke tipe lokal', rows.length === 1 && rows[0]?.storagePath === uploaded.path && rows[0]?.checksum === uploaded.checksum)
check('daftar snapshot memakai filter outlet + urutan terbaru', (calls[0]?.url ?? '').includes(`outlet_id=eq.${outletId}`) && (calls[0]?.url ?? '').includes('order=created_at.desc'))

const downloaded = await cloud.downloadCloudSnapshot(config, session, rows[0]!.storagePath, { key, fetchImpl: fakeFetch })
check('unduhan mengembalikan plaintext yang bisa dipulihkan', downloaded.text === plaintext)
const inspected = inspectBackupValue(JSON.parse(downloaded.text) as unknown)
check('snapshot cloud lolos validasi backup yang sama dengan restore lokal', inspected.ok)
check('checksum unduhan sama dengan metadata', downloaded.checksum === rows[0]!.checksum)

await expectThrow('restore dengan frasa sandi salah ditolak', () => cloud.downloadCloudSnapshot(config, session, rows[0]!.storagePath, { passphrase: 'frasa-keliru-sekali', fetchImpl: fakeFetch }), 'tidak bisa didekripsi')

reset(() => new Response(JSON.stringify({ format: 'bukan-backup' }), { status: 200 }))
await expectThrow('snapshot cloud rusak ditolak sebelum menimpa data', () => cloud.downloadCloudSnapshot(config, session, rows[0]!.storagePath, { key, fetchImpl: fakeFetch }), 'tidak dikenal')

/* -------------------------------------------------------------------------- */
/* 7. Persistensi konfigurasi & sesi                                          */
/* -------------------------------------------------------------------------- */

await cloud.saveCloudConfig(config)
const storedConfig = await cloud.loadCloudConfig(true)
check('konfigurasi cloud tersimpan lengkap', storedConfig?.enabled === true && storedConfig.outletId === outletId && storedConfig.key?.material === key.material)

await cloud.saveCloudSession(session)
const storedSession = await cloud.loadCloudSession()
check('sesi cloud tersimpan untuk unggahan berikutnya', storedSession?.accessToken === accessToken && storedSession.expiresAt === session.expiresAt)

await cloud.disableCloudBackup(storedConfig)
const afterDisable = await cloud.loadCloudConfig(true)
const sessionAfterDisable = await cloud.loadCloudSession()
check('menonaktifkan cloud mempertahankan konfigurasi nonaktif', afterDisable?.enabled === false && afterDisable.outletId === outletId)
check('menonaktifkan cloud menghapus sesi', sessionAfterDisable === null)
check('status setelah nonaktif = disabled', cloud.getCloudStatus().state === 'disabled')

check('validasi form menolak service role key', (cloud.validateCloudConfigInput({
  projectUrl, anonKey: 'service_role_abc', outletId, email: 'a@b.c', password: '123456', passphrase: 'frasa-sandi', passphraseConfirm: 'frasa-sandi',
}) ?? '').includes('service role'))
check('validasi form menolak HTTP non-localhost', (cloud.validateCloudConfigInput({
  projectUrl: 'http://contoh.test', anonKey, outletId, email: 'a@b.c', password: '123456', passphrase: 'frasa-sandi', passphraseConfirm: 'frasa-sandi',
}) ?? '').includes('HTTPS'))
check('validasi form menolak frasa sandi tidak sama', (cloud.validateCloudConfigInput({
  projectUrl, anonKey, outletId, email: 'a@b.c', password: '123456', passphrase: 'frasa-sandi', passphraseConfirm: 'beda-frasa',
}) ?? '').includes('Konfirmasi'))
check('validasi form menerima input lengkap', cloud.validateCloudConfigInput({
  projectUrl, anonKey, outletId, email: 'owner@example.test', password: 'rahasia', passphrase: 'frasa-sandi', passphraseConfirm: 'frasa-sandi',
}) === null)

/* -------------------------------------------------------------------------- */
/* 8. Prefill dari environment build                                         */
/* -------------------------------------------------------------------------- */

check('prefill env kosong tidak dipaksakan', supabaseEnvDefaults({}) === null)
const envDefaults = supabaseEnvDefaults({
  VITE_SUPABASE_URL: ' https://env-uji.supabase.co ',
  VITE_SUPABASE_ANON_KEY: ' anon-env-uji ',
  VITE_OUTLET_ID: ` ${outletId} `,
})
check(
  'prefill env memangkas URL, anon key, dan outlet',
  envDefaults?.projectUrl === 'https://env-uji.supabase.co' && envDefaults.anonKey === 'anon-env-uji' && envDefaults.outletId === outletId,
  JSON.stringify(envDefaults),
)
check(
  'prefill env parsial hanya mengisi field yang tersedia',
  (() => {
    const partial = supabaseEnvDefaults({ VITE_SUPABASE_URL: 'https://env-uji.supabase.co' })
    return partial?.projectUrl === 'https://env-uji.supabase.co' && partial.anonKey === '' && partial.outletId === ''
  })(),
)
check(
  'nilai tersimpan menang atas prefill env',
  (() => {
    const merged = mergeSupabaseDefaults(envDefaults, {
      projectUrl: 'https://tersimpan.supabase.co',
      anonKey: 'anon-tersimpan',
      outletId: 'outlet-tersimpan',
    })
    return merged.projectUrl === 'https://tersimpan.supabase.co' && merged.anonKey === 'anon-tersimpan' && merged.outletId === 'outlet-tersimpan'
  })(),
)
check(
  'env mengisi field yang belum tersimpan',
  (() => {
    const merged = mergeSupabaseDefaults(envDefaults, { projectUrl: 'https://tersimpan.supabase.co' })
    return merged.projectUrl === 'https://tersimpan.supabase.co' && merged.anonKey === 'anon-env-uji' && merged.outletId === outletId
  })(),
)

/* -------------------------------------------------------------------------- */
/* 9. Sambung otomatis tanpa membuka pengaturan                               */
/* -------------------------------------------------------------------------- */

await cloud.saveCloudConfig(config)

reset()
await cloud.clearCloudSession()
const withoutSession = await cloud.ensureCloudConnection({ fetchImpl: fakeFetch })
check('tanpa sesi tersimpan → belum tersambung, tanpa jaringan', withoutSession === null && calls.length === 0)
check('tanpa sesi status meminta masuk sekali', cloud.getCloudStatus().state === 'pending-setup' && (cloud.getCloudStatus().lastError ?? '').includes('sekali'))

await cloud.saveCloudSession(session)
reset()
const autoConnected = await cloud.ensureCloudConnection({ fetchImpl: fakeFetch })
check('sesi tersimpan dipakai ulang otomatis tanpa jaringan', autoConnected?.session.accessToken === accessToken && autoConnected.refreshed === false && calls.length === 0)
check('waktu koneksi otomatis tercatat untuk panel', Boolean(cloud.getCloudStatus().lastConnectedAt) && cloud.getCloudStatus().state !== 'pending-setup')

const expiring: cloud.CloudSession = { ...session, accessToken: 'token-lama', refreshToken: 'refresh-lama', expiresAt: 0 }
await cloud.saveCloudSession(expiring)
reset((call) => call.url.includes('grant_type=refresh_token')
  ? new Response(JSON.stringify({ access_token: 'token-baru', refresh_token: 'refresh-baru', expires_in: 3600, user: { id: session.userId, email: session.email } }), { status: 200 })
  : new Response('{}', { status: 200 }))
const refreshedConnection = await cloud.ensureCloudConnection({ fetchImpl: fakeFetch })
check('token kedaluwarsa diperbarui otomatis di latar belakang', refreshedConnection?.refreshed === true && refreshedConnection.session.accessToken === 'token-baru')
check(
  'refresh memakai refresh token, bukan kata sandi',
  calls.length === 1 && calls[0]!.url.includes('grant_type=refresh_token') && calls[0]!.body.includes('refresh-lama') && !calls[0]!.body.includes('password'),
)
check('token baru disimpan sehingga putaran berikutnya tanpa jaringan', (await cloud.loadCloudSession())?.refreshToken === 'refresh-baru')

reset()
const reusedConnection = await cloud.ensureCloudConnection({ fetchImpl: fakeFetch })
check('setelah refresh, koneksi berikutnya tidak memanggil jaringan', reusedConnection?.refreshed === false && calls.length === 0)

await cloud.saveCloudSession(expiring)
reset(() => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }), { status: 400 }))
const rejected = await cloud.ensureCloudConnection({ fetchImpl: fakeFetch })
check('refresh ditolak → status pending-setup, bukan crash', rejected === null && cloud.getCloudStatus().state === 'pending-setup')
check('sesi mati dibersihkan agar tidak mencoba tanpa akhir', (await cloud.loadCloudSession()) === null)

await cloud.saveCloudSession(expiring)
reset(() => { throw new Error('jaringan mati') })
const offlineConnection = await cloud.ensureCloudConnection({ fetchImpl: fakeFetch })
check('gangguan jaringan saat refresh → status error, bukan exception', offlineConnection === null && cloud.getCloudStatus().state === 'error')
check('sesi disimpan untuk dicoba lagi saat online', (await cloud.loadCloudSession())?.refreshToken === 'refresh-lama')

const noKeyConfig: cloud.CloudBackupConfig = { ...config, key: null }
reset()
const incomplete = await cloud.ensureCloudConnection({ config: noKeyConfig, fetchImpl: fakeFetch })
check('konfigurasi tanpa kunci tidak dianggap tersambung', incomplete === null && calls.length === 0)

await cloud.disableCloudBackup(await cloud.loadCloudConfig(true))
reset()
const disabledConnection = await cloud.ensureCloudConnection({ fetchImpl: fakeFetch })
check('cloud dimatikan → tidak ada koneksi otomatis maupun jaringan', disabledConnection === null && calls.length === 0 && cloud.getCloudStatus().state === 'disabled')

if (failures > 0) {
  console.error(`\n${failures} dari ${checks} pemeriksaan cloud backup gagal`)
  process.exit(1)
}
console.log(`\nSemua ${checks} pemeriksaan cloud backup lolos (mock fetch, tanpa Supabase nyata)`)
