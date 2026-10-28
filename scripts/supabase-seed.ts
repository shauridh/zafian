/**
 * CLI: staging Fase 0 (JSONL) → seed SQL Supabase staging.
 *
 * Pemakaian:
 *   bun run db:seed --outlet-id <uuid-outlet> --owner-user-id <uuid-auth-user>
 *
 * Membaca staging/supabase/manifest.json + 19 file JSONL, memverifikasi
 * checksum dan jumlah baris, lalu menulis supabase/seed/seed.sql dan
 * supabase/seed/verify.sql. Tidak menghubungi Supabase.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { buildSeedArtifacts } from '../src/lib/supabase-seed'
import { STAGING_FORMAT, STAGING_FORMAT_VERSION, STAGING_TABLES, type StagingManifest, type StagingRow, type StagingTableName } from '../src/lib/sync-staging'

type WrittenManifest = StagingManifest & { files: { table: StagingTableName; rows: number; file: string; sha256: string }[] }

type Args = { staging: string; out: string; outletId?: string; ownerUserId?: string }

function parseArgs(argv: string[]): Args | null {
  const args: Args = { staging: 'staging/supabase', out: 'supabase/seed' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--help' || flag === '-h') return null
    if (!value || value.startsWith('--')) {
      console.error(`Nilai untuk ${flag} tidak ditemukan.`)
      return null
    }
    if (flag === '--staging') args.staging = value
    else if (flag === '--out') args.out = value
    else if (flag === '--outlet-id') args.outletId = value
    else if (flag === '--owner-user-id') args.ownerUserId = value
    else {
      console.error(`Argumen tidak dikenal: ${flag}`)
      return null
    }
    index += 1
  }
  return args
}

const usage = `Pemakaian:
  bun run db:seed --outlet-id <uuid-outlet> --owner-user-id <uuid-auth-user> [--staging <folder>] [--out <folder>]

owner-user-id harus user Supabase (auth.users) yang sudah dibuat lebih dulu.`

const args = parseArgs(process.argv.slice(2))
if (!args?.outletId || !args.ownerUserId) {
  console.error(usage)
  process.exit(1)
}

const stagingDir = resolve(args.staging)
const manifestPath = join(stagingDir, 'manifest.json')
if (!existsSync(manifestPath)) {
  console.error(`Manifest staging tidak ditemukan: ${manifestPath}\nJalankan bun run sync:export lebih dulu.`)
  process.exit(1)
}

let manifest: WrittenManifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WrittenManifest
} catch (error) {
  console.error(`Manifest staging tidak bisa dibaca: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
if (manifest.format !== STAGING_FORMAT || manifest.formatVersion !== STAGING_FORMAT_VERSION) {
  console.error(`Format staging tidak dikenal: ${String(manifest.format)} v${String(manifest.formatVersion)}`)
  process.exit(1)
}

const tables = {} as Record<StagingTableName, StagingRow[]>
for (const table of STAGING_TABLES) {
  const file = manifest.files.find((entry) => entry.table === table)
  if (!file) { console.error(`Manifest tidak memuat file untuk ${table}.`); process.exit(1) }
  const content = readFileSync(join(stagingDir, file.file), 'utf8')
  const checksum = createHash('sha256').update(content).digest('hex')
  if (checksum !== file.sha256) {
    console.error(`Checksum ${file.file} tidak cocok. Jalankan ulang sync:export.`)
    process.exit(1)
  }
  const lines = content.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length !== file.rows) {
    console.error(`${file.file}: ${lines.length} baris, manifest menyebut ${file.rows}.`)
    process.exit(1)
  }
  try {
    tables[table] = lines.map((line) => JSON.parse(line) as StagingRow)
  } catch (error) {
    console.error(`${file.file} bukan JSONL valid: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

const artifacts = buildSeedArtifacts(tables, manifest, { outletId: args.outletId, ownerUserId: args.ownerUserId })
const outDir = resolve(args.out)
mkdirSync(outDir, { recursive: true })
const seedPath = join(outDir, 'seed.sql')
const verifyPath = join(outDir, 'verify.sql')
writeFileSync(seedPath, artifacts.seedSql, 'utf8')
writeFileSync(verifyPath, artifacts.verifySql, 'utf8')

console.log(`Sumber staging : ${stagingDir}`)
console.log(`Outlet target  : ${args.outletId}`)
console.log(`Owner user     : ${args.ownerUserId}`)
console.log(`Seed SQL       : ${seedPath} (${artifacts.seedSql.split('\n').length} baris)`)
console.log(`Verifikasi SQL : ${verifyPath}`)
console.log(`Baris staging  : ${STAGING_TABLES.reduce((sum, table) => sum + tables[table].length, 0)}`)
console.log(`Penjualan      : Rp${manifest.control.money.revenue.toLocaleString('id-ID')}`)
console.log(`Jurnal         : ${manifest.control.journals.entries} entri • ${manifest.control.journals.balanced ? 'seimbang' : 'TIDAK seimbang'}`)
