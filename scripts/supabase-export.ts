/**
 * CLI Fase 0: backup JSON Sabana POS → staging JSONL untuk Supabase.
 *
 * Pemakaian:
 *   bun run sync:export --input sabana-pos-backup-2026-10-26-manual.json
 *   bun run sync:export --input scripts/fixtures/supabase-seed.json --out staging/supabase
 *
 * Script ini tidak menghubungi Supabase dan tidak mengubah aplikasi/IndexedDB.
 * Keluar dengan kode 1 bila ada error validasi (staging tidak ditulis).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { inspectBackup } from '../src/lib/backup'
import { buildStagingExport, STAGING_TABLES } from '../src/lib/sync-staging'

type Args = {
  input?: string
  out: string
  outletId?: string
  deviceId?: string
}

function parseArgs(argv: string[]): Args | null {
  const args: Args = { out: 'staging/supabase' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--help' || flag === '-h') return null
    if (!value || value.startsWith('--')) {
      console.error(`Nilai untuk ${flag} tidak ditemukan.`)
      return null
    }
    if (flag === '--input') args.input = value
    else if (flag === '--out') args.out = value
    else if (flag === '--outlet-id') args.outletId = value
    else if (flag === '--device-id') args.deviceId = value
    else {
      console.error(`Argumen tidak dikenal: ${flag}`)
      return null
    }
    index += 1
  }
  return args
}

const usage = `Pemakaian:
  bun run sync:export --input <backup.json> [--out <folder>] [--outlet-id <uuid>] [--device-id <teks>]

Contoh:
  bun run sync:export --input scripts/fixtures/supabase-seed.json --out staging/supabase`

const args = parseArgs(process.argv.slice(2))
if (!args?.input) {
  console.error(usage)
  process.exit(1)
}

const inputPath = resolve(args.input)
let raw: string
try {
  raw = readFileSync(inputPath, 'utf8')
} catch (error) {
  console.error(`Tidak bisa membaca ${inputPath}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const inspected = inspectBackup(raw)
if (!inspected.ok) {
  console.error(`Backup ditolak: ${inspected.error}`)
  process.exit(1)
}

const exportResult = buildStagingExport(inspected.store, {
  ...(args.outletId ? { outletId: args.outletId } : {}),
  ...(args.deviceId ? { deviceId: args.deviceId } : {}),
})
const errors = exportResult.manifest.issues.filter((issue) => issue.severity === 'error')
const warnings = exportResult.manifest.issues.filter((issue) => issue.severity === 'warning')

console.log(`Sumber      : ${inputPath}`)
console.log(`Outlet      : ${exportResult.manifest.outletId}`)
console.log(`Device      : ${exportResult.manifest.deviceId}`)
console.log(`Skema lokal : v${exportResult.manifest.appSchemaVersion}`)

if (warnings.length > 0) {
  console.warn(`\nPeringatan (${warnings.length}):`)
  for (const issue of warnings) console.warn(`  [${issue.code}] ${issue.message}`)
}

if (errors.length > 0) {
  console.error(`\n${errors.length} error validasi — staging TIDAK ditulis:`)
  for (const issue of errors) console.error(`  [${issue.code}] ${issue.message}`)
  process.exit(1)
}

const outDir = resolve(args.out)
mkdirSync(outDir, { recursive: true })

const files: { table: string; rows: number; file: string; sha256: string }[] = []
for (const table of STAGING_TABLES) {
  const rows = exportResult.tables[table]
  const content = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '')
  const fileName = `${table}.jsonl`
  writeFileSync(join(outDir, fileName), content, 'utf8')
  files.push({
    table,
    rows: rows.length,
    file: fileName,
    sha256: createHash('sha256').update(content).digest('hex'),
  })
}

const manifest = { ...exportResult.manifest, files }
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log('\nTabel staging:')
for (const file of files) {
  if (file.rows > 0) console.log(`  ${file.table.padEnd(18)} ${String(file.rows).padStart(5)} baris`)
}
console.log(`  ${'(kosong)'.padEnd(18)} ${files.filter((file) => file.rows === 0).length} tabel`)

const control = exportResult.manifest.control
console.log('\nAngka kontrol:')
console.log(`  Penjualan selesai : Rp${control.money.revenue.toLocaleString('id-ID')}`)
console.log(`  Kas tunai         : Rp${control.money.cashSales.toLocaleString('id-ID')}`)
console.log(`  Jurnal            : ${control.journals.entries} entri • debit Rp${control.journals.debit.toLocaleString('id-ID')} • kredit Rp${control.journals.credit.toLocaleString('id-ID')} • ${control.journals.balanced ? 'seimbang' : 'TIDAK seimbang'}`)
console.log(`  Dikecualikan      : ${exportResult.manifest.excluded.heldOrders} held order (lokal saja)`)

if (exportResult.manifest.outletId === 'outlet-local') {
  console.warn('\nCatatan: outletId masih placeholder. Setelah outlet dibuat di Supabase, jalankan ulang dengan --outlet-id <uuid>.')
}

console.log(`\nStaging ditulis ke ${outDir}`)
