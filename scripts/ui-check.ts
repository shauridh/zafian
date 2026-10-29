/**
 * check:ui — audit UI end-to-end untuk enam butir misi kasir.
 *
 * Menjalankan Chromium headless (Playwright) terhadap aplikasi sungguhan, lalu
 * memeriksa lewat DOM dan IndexedDB:
 *   1. CRUD menu (tambah + foto, edit, hapus) dan CRUD bahan
 *   2. Kategori: tambah, ubah, hapus, proteksi kategori terpakai, strip kasir
 *   3. Foto menu di kasir: object-fit contain, konten tidak gepeng/terpotong
 *   4. Bulk pembelian 3 baris sekali simpan menambah stok ketiga bahan
 *   4b. Isi pemakaian standar beberapa bahan sekaligus lalu dipakai resep menu
 *   5. Mode pemilik: PIN dan 8 tab terjangkau
 *   6. Pengaturan printer: 80 mm + 2 salinan persist setelah reload dan dipakai tes cetak
 *   7. Buka shift, transaksi tunai, struk tercetak (80 mm/2 salinan), lalu tutup shift
 *   + nol overflow horizontal di 1024x600, 1280x800, 800x1280, 360x640
 *
 * Hasil per pemeriksaan ditulis sebagai JSON ke `.screenshots/ui-check/report.json`
 * (set UI_CHECK_REPORT untuk lokasi lain, mis. artifacts/ui-check-report.json di CI).
 *
 * Prasyarat (sekali): `bunx playwright install --with-deps chromium`.
 * Tanpa UI_BASE_URL, skrip memakai dev server yang sudah hidup di :3000 atau
 * menyalakan server Vite sendiri di port bebas. Set UI_CHECK_OWN_SERVER=1 untuk
 * selalu menyalakan server sendiri (mis. di CI) dan UI_BASE_URL untuk menunjuk
 * server lain.
 *
 * Screenshot ditulis ke `.screenshots/ui-check/` (gitignored). Set
 * UI_CHECK_SCREENSHOTS=0 untuk mematikannya.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const SHOTS = resolve(ROOT, '.screenshots/ui-check')
const WITH_SHOTS = process.env.UI_CHECK_SCREENSHOTS !== '0'
const EXTERNAL_BASE = (process.env.UI_BASE_URL ?? '').trim().replace(/\/$/, '')
const FORCE_OWN_SERVER = process.env.UI_CHECK_OWN_SERVER === '1'
const REPORT_PATH = process.env.UI_CHECK_REPORT?.trim()
  ? resolve(ROOT, process.env.UI_CHECK_REPORT.trim())
  : resolve(SHOTS, 'report.json')
const CHROMIUM_EXECUTABLE = (process.env.UI_CHECK_CHROMIUM_EXECUTABLE ?? '').trim()

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
function check(name: string, ok: boolean, detail: unknown = ''): void {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` :: ${detail}`}`)
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await responds(url)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Dev server tidak siap dalam ${Math.round(timeoutMs / 1000)} detik: ${url}`)
}

type Server = { base: string; stop: () => void; mode: 'external' | 'reused' | 'spawned' }

async function ensureServer(): Promise<Server> {
  if (EXTERNAL_BASE) {
    await waitForServer(EXTERNAL_BASE, 30_000)
    return { base: EXTERNAL_BASE, stop: () => {}, mode: 'external' }
  }
  const local = 'http://127.0.0.1:3000'
  if (!FORCE_OWN_SERVER && await responds(local)) {
    console.log(`! Memakai dev server yang sudah berjalan: ${local}`)
    return { base: local, stop: () => {}, mode: 'reused' }
  }
  mkdirSync(SHOTS, { recursive: true })
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const log = openSync(resolve(SHOTS, 'dev-server.log'), 'a')
  const child: ChildProcess = spawn(
    process.execPath,
    ['x', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: { ...process.env, BROWSER: 'none' } },
  )
  const stop = () => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try { child.kill('SIGTERM') } catch { /* already stopped */ }
    }
  }
  const onSignal = () => { stop(); process.exit(130) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  console.log(`! Menyalakan dev server untuk check:ui: ${base}`)
  await waitForServer(base)
  return { base, stop, mode: 'spawned' }
}

function buildProductionBundle(): Promise<boolean> {
  return new Promise((resolveBuild) => {
    const child = spawn(process.execPath, ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', (chunk) => { output += String(chunk) })
    child.stderr?.on('data', (chunk) => { output += String(chunk) })
    child.on('close', (code) => {
      if (code !== 0) console.error(output.slice(-2000))
      resolveBuild(code === 0)
    })
  })
}

type StaticPreview = { base: string; stop: () => void }

/** Menyajikan dist/client hasil build produksi (SPA fallback) untuk uji service worker. */
async function startStaticPreview(): Promise<StaticPreview> {
  const clientDir = resolve(ROOT, 'dist/client')
  const server = Bun.serve({
    port: 0,
    async fetch(request: Request) {
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname)
      // Tiru hosting produksi: /index.html di-redirect ke '/'. Service worker tidak
      // boleh mem-precache respons redirect ini untuk navigasi offline.
      if (pathname === '/index.html') return Response.redirect(`${url.origin}/`, 307)
      const target = pathname === '/' ? resolve(clientDir, 'index.html') : resolve(clientDir, `.${pathname}`)
      if (target.startsWith(clientDir)) {
        const file = Bun.file(target)
        if (await file.exists()) return new Response(file)
      }
      if (!pathname.includes('.')) {
        const shell = Bun.file(resolve(clientDir, 'index.html'))
        if (await shell.exists()) return new Response(shell)
      }
      return new Response('Tidak ditemukan', { status: 404 })
    },
  })
  console.log(`! Preview produksi untuk uji PWA: http://127.0.0.1:${server.port}`)
  return { base: `http://127.0.0.1:${server.port}`, stop: () => { server.stop(true) } }
}

const OUT_KEYS = ['menus', 'ingredients', 'categories', 'stockMovements', 'settings', 'auditLog'] as const

async function main(): Promise<number> {
  const server = await ensureServer()
  const startedAt = Date.now()
  const writeReport = (exitCode: number) => {
    const failed = checks.filter((entry) => !entry.ok)
    const report = {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      baseUrl: server.base,
      serverMode: server.mode,
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      exitCode,
      checks,
    }
    try {
      mkdirSync(dirname(REPORT_PATH), { recursive: true })
      writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
      console.log(`Laporan JSON: ${REPORT_PATH}`)
    } catch (error) {
      console.error(`! Gagal menulis laporan JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (WITH_SHOTS) mkdirSync(SHOTS, { recursive: true })
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      ...(CHROMIUM_EXECUTABLE ? { executablePath: CHROMIUM_EXECUTABLE } : {}),
    })
  } catch (error) {
    server.stop()
    console.error('\n✖ Chromium untuk Playwright tidak bisa dijalankan.')
    console.error('  Jalankan sekali: bunx playwright install --with-deps chromium')
    console.error('  (tanpa akses apt: bunx playwright install chromium, lalu pasang libnspr4/nss secara manual)')
    console.error(`  Detail: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    writeReport(2)
    return 2
  }
  if (!browser) {
    writeReport(2)
    return 2
  }

  const context = await browser.newContext({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const dialogMessages: string[] = []
  page.on('dialog', (dialog) => { dialogMessages.push(dialog.message()); void dialog.accept() })
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => consoleErrors.push(String(error).slice(0, 200)))
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)) })

  const shot = async (name: string) => {
    if (WITH_SHOTS) await page.screenshot({ path: resolve(SHOTS, `${name}.png`) })
  }
  const settle = (ms = 400) => page.waitForTimeout(ms)
  const installPrintCapture = async () => {
    await page.evaluate(() => {
      ;(window as unknown as { __printHtml: string | null }).__printHtml = null
      window.open = () => ({
        document: { write: (html: string) => { (window as unknown as { __printHtml: string | null }).__printHtml = html }, close: () => {} },
        close: () => {},
        focus: () => {},
        print: () => {},
      }) as unknown as Window
    })
  }
  const readStore = () => page.evaluate(() => new Promise((resolveStore, reject) => {
    const request = indexedDB.open('sabana-pos')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const storeName = db.objectStoreNames[0]
      const get = db.transaction(storeName, 'readonly').objectStore(storeName).get('pos-store')
      get.onsuccess = () => resolveStore(get.result)
      get.onerror = () => reject(get.error)
    }
  })) as Promise<Record<string, any>>
  const writeStore = (value: Record<string, any>) => page.evaluate((next) => new Promise<void>((resolveStore, rejectStore) => {
    const request = indexedDB.open('sabana-pos')
    request.onerror = () => rejectStore(request.error)
    request.onsuccess = () => {
      const db = request.result
      const storeName = db.objectStoreNames[0]
      const transaction = db.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(next, 'pos-store')
      transaction.oncomplete = () => resolveStore()
      transaction.onerror = () => rejectStore(transaction.error)
    }
  }), value)
  const field = (label: string) => page.locator('.owner-field', { hasText: label }).locator('input, textarea, select').first()
  const navTo = async (label: string) => {
    await page.locator('.owner-nav button', { hasText: label }).first().click()
    await settle(240)
  }
  const enterOwner = async () => {
    await page.locator('[aria-label="Buka mode pemilik"]').click()
    await page.waitForSelector('.pin-modal', { timeout: 10_000 })
    if (await page.locator('[aria-label="PIN baru"]').count()) {
      await page.locator('[aria-label="PIN baru"]').fill('1234')
      await page.locator('[aria-label="Ulangi PIN"]').fill('1234')
      await page.getByRole('button', { name: 'Buat PIN', exact: true }).click()
      await page.getByRole('button', { name: 'Saya sudah menyimpan kode' }).click()
    } else {
      await page.locator('input[aria-label="PIN pemilik"]').fill('1234')
      await page.getByRole('button', { name: 'Buka', exact: true }).click()
    }
    await page.waitForSelector('.owner-layout', { timeout: 15_000 })
    await settle(320)
  }
  const backToPos = async () => {
    await page.getByRole('button', { name: 'Kasir', exact: true }).click()
    await page.waitForSelector('.pos-screen')
    await settle(320)
  }
  const stockCell = async (name: string) => {
    const row = page.locator('.owner-data tbody tr').filter({ has: page.locator('td strong', { hasText: new RegExp(`^${name}$`) }) }).first()
    const text = (await row.locator('td').nth(1).innerText()).trim()
    return { text, value: Number((text.match(/-?[\d.]+/) ?? ['0'])[0].replace(/[^0-9-]/g, '')) }
  }

  try {
    await page.goto(server.base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.pos-screen', { timeout: 30_000 })
    await settle(700)

    const base = await readStore()
    check('store awal terbaca dari IndexedDB', Array.isArray(base.menus) && Array.isArray(base.ingredients), `menus=${base.menus?.length} bahan=${base.ingredients?.length}`)
    for (const key of OUT_KEYS) if (!(key in base)) check(`store memiliki ${key}`, false, 'tidak ditemukan')

    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 200
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#b71c1c'
      ctx.fillRect(0, 0, 400, 200)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 44px sans-serif'
      ctx.fillText('UI CHECK', 96, 118)
      return canvas.toDataURL('image/png')
    })
    const imageBytes = Buffer.from(png.split(',')[1], 'base64')

    // ---------- 5. Mode pemilik: PIN + semua tab ----------
    await enterOwner()
    check('mode pemilik terbuka lewat PIN', await page.locator('.owner-layout').count() === 1)
    const navButtons = page.locator('.owner-nav button')
    const navCount = await navButtons.count()
    check('mode pemilik memiliki 8 tab', navCount === 8, String(navCount))
    for (let index = 0; index < navCount; index += 1) {
      const label = (await navButtons.nth(index).innerText()).trim()
      await navButtons.nth(index).click()
      await settle(180)
      const heading = (await page.locator('.owner-page-head h1').innerText()).trim()
      check(`tab terjangkau: ${label}`, heading.length > 0, heading)
    }

    // ---------- 1. CRUD menu + 3. foto menu ----------
    await navTo('Menu & HPP')
    await page.getByRole('button', { name: 'Menu baru' }).first().click()
    await page.waitForSelector('.modal.editor')
    await page.locator('.modal.editor input[type=file]').setInputFiles({ name: 'ui-check.png', mimeType: 'image/png', buffer: imageBytes })
    await page.waitForSelector('.image-preview img', { timeout: 10_000 })
    await field('Nama menu').fill('Menu Uji UI')
    await field('Harga jual').fill('21000')
    await page.locator('[aria-label="Menu sumber resep"]').selectOption({ label: 'Ayam Dada + Nasi (9 bahan)' })
    await page.locator('[aria-label="Faktor porsi resep"]').fill('1.5')
    await page.getByRole('button', { name: 'Salin resep', exact: true }).click()
    await settle(350)
    const copiedRows = await page.locator('.modal.editor .recipe-row').count()
    check('salin resep mengisi baris resep menu baru', copiedRows === 9, String(copiedRows))
    const copiedFirstQty = await page.locator('.modal.editor .recipe-row').first().locator('input[type=number]').inputValue()
    check('faktor porsi 1,5 menyesuaikan jumlah bahan', copiedFirstQty === '1.5', copiedFirstQty)
    const copiedHpp = (await page.locator('.modal.editor .hpp-summary').innerText()).replace(/\s+/g, ' ')
    check('HPP menu salinan dihitung otomatis', /Rp[1-9][\d.]*/.test(copiedHpp), copiedHpp)
    await shot('resep-salin')
    await page.getByRole('button', { name: 'Tambah menu', exact: true }).click()
    await settle(600)

    let store = await readStore()
    const createdMenu = store.menus.find((menu: any) => menu.name === 'Menu Uji UI')
    check('menu dibuat', Boolean(createdMenu), createdMenu?.id ?? 'tidak ada')
    check('foto menu tersimpan sebagai data URL', Boolean(createdMenu?.imageUrl?.startsWith('data:image')), String(createdMenu?.imageUrl).slice(0, 24))

    const createdCard = page.locator('.owner-menu-card', { hasText: 'Menu Uji UI' }).first()
    await createdCard.getByRole('button', { name: 'Nonaktifkan' }).click()
    await settle(350)
    store = await readStore()
    check('menu bisa dinonaktifkan', store.menus.find((menu: any) => menu.name === 'Menu Uji UI')?.active === false)
    await backToPos()
    check('menu nonaktif hilang dari katalog kasir', await page.locator('.menu-card', { hasText: 'Menu Uji UI' }).count() === 0)
    await enterOwner()
    await navTo('Menu & HPP')
    await page.locator('.owner-menu-card', { hasText: 'Menu Uji UI' }).first().getByRole('button', { name: 'Aktifkan' }).click()
    await settle(350)
    store = await readStore()
    check('menu bisa diaktifkan kembali', store.menus.find((menu: any) => menu.name === 'Menu Uji UI')?.active === true)
    await backToPos()


    const menuCard = page.locator('.menu-card', { hasText: 'Menu Uji UI' }).first()
    check('menu baru tampil di katalog kasir', await menuCard.count() > 0)
    const image = await menuCard.locator('.menu-art img').evaluate((element: HTMLImageElement) => {
      const rect = element.getBoundingClientRect()
      return { naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, width: Math.round(rect.width), height: Math.round(rect.height), fit: getComputedStyle(element).objectFit }
    })
    const scale = Math.min(image.width / image.naturalWidth, image.height / image.naturalHeight)
    check('foto di kasir memakai object-fit contain', image.fit === 'contain', JSON.stringify(image))
    check(
      'foto utuh tanpa crop/gepeng',
      Math.abs(scale * image.naturalWidth - image.width) < 1.5
        && scale * image.naturalHeight <= image.height + 1.5
        && Math.abs(image.naturalWidth / image.naturalHeight - 2) < 0.01,
      `konten=${(scale * image.naturalWidth).toFixed(1)}x${(scale * image.naturalHeight).toFixed(1)} box=${image.width}x${image.height}`,
    )
    await shot('kasir-menu-gambar')

    await enterOwner()
    await navTo('Menu & HPP')
    const ownerCard = page.locator('.owner-menu-card', { hasText: 'Menu Uji UI' }).first()
    await ownerCard.locator('.owner-menu-photo img').waitFor({ timeout: 10_000 })
    const ownerImage = await ownerCard.locator('.owner-menu-photo img').evaluate((element: HTMLImageElement) => {
      const rect = element.getBoundingClientRect()
      return { naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, width: Math.round(rect.width), height: Math.round(rect.height), fit: getComputedStyle(element).objectFit }
    })
    const ownerScale = Math.min(ownerImage.width / ownerImage.naturalWidth, ownerImage.height / ownerImage.naturalHeight)
    check('foto di mode pemilik memakai object-fit contain', ownerImage.fit === 'contain', JSON.stringify(ownerImage))
    check(
      'foto pemilik utuh tanpa crop/gepeng',
      Math.abs(ownerScale * ownerImage.naturalWidth - ownerImage.width) < 1.5
        && ownerScale * ownerImage.naturalHeight <= ownerImage.height + 1.5
        && Math.abs(ownerImage.naturalWidth / ownerImage.naturalHeight - 2) < 0.01,
      `konten=${(ownerScale * ownerImage.naturalWidth).toFixed(1)}x${(ownerScale * ownerImage.naturalHeight).toFixed(1)} box=${ownerImage.width}x${ownerImage.height}`,
    )
    const ownerPhoto = await ownerCard.locator('.owner-menu-photo').evaluate((element) => ({ aspectRatio: getComputedStyle(element).aspectRatio, overflow: getComputedStyle(element).overflow }))
    check('wadah foto pemilik memakai rasio 4:3', ownerPhoto.aspectRatio.replace(/\s/g, '') === '4/3' && ownerPhoto.overflow === 'hidden', JSON.stringify(ownerPhoto))
    await ownerCard.getByRole('button', { name: 'Edit' }).click()
    await page.waitForSelector('.modal.editor')
    await field('Nama menu').fill('Menu Uji UI 2')
    await field('Harga jual').fill('22000')
    await page.getByRole('button', { name: 'Simpan perubahan' }).click()
    await settle(500)
    store = await readStore()
    const editedMenu = store.menus.find((menu: any) => menu.name === 'Menu Uji UI 2')
    check('menu diedit (nama + harga)', Boolean(editedMenu) && editedMenu.price === 22000, editedMenu ? `${editedMenu.name} ${editedMenu.price}` : 'tidak ada')
    await backToPos()
    check('harga baru tampil di kasir', (await page.locator('.menu-card', { hasText: 'Menu Uji UI 2' }).first().innerText()).includes('Rp22.000'))

    await enterOwner()
    await navTo('Menu & HPP')
    await shot('menu-katalog')
    await page.locator('.owner-menu-card', { hasText: 'Menu Uji UI 2' }).first().getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('button', { name: 'Hapus menu' }).click()
    await page.waitForSelector('.owner-confirm')
    store = await readStore()
    check('hapus menu membuka dialog konfirmasi di aplikasi', (await page.locator('.owner-confirm').count()) === 1)
    check('menu belum terhapus sebelum konfirmasi', Boolean(store.menus.find((menu: any) => menu.name === 'Menu Uji UI 2')))
    await page.locator('.owner-confirm').getByRole('button', { name: 'Batal' }).click()
    await settle(300)
    store = await readStore()
    check('batal tidak menghapus menu', Boolean(store.menus.find((menu: any) => menu.name === 'Menu Uji UI 2')) && (await page.locator('.owner-confirm').count()) === 0)
    await shot('hapus-menu-konfirmasi-batal')
    await page.getByRole('button', { name: 'Hapus menu' }).click()
    await page.waitForSelector('.owner-confirm')
    await page.getByRole('button', { name: 'Hapus dari katalog' }).click()
    await settle(500)
    store = await readStore()
    check('menu dihapus dari store', !store.menus.some((menu: any) => menu.name === 'Menu Uji UI 2'))
    await backToPos()
    check('menu hilang dari katalog kasir', await page.locator('.menu-card', { hasText: 'Menu Uji UI 2' }).count() === 0)

    // ---------- 1. CRUD bahan + 4. bulk pembelian ----------
    await enterOwner()
    await navTo('Bahan & stok')
    await page.getByRole('button', { name: 'Bahan baru' }).first().click()
    await page.waitForSelector('.modal')
    await field('Nama bahan').fill('Bahan Uji UI')
    await field('Satuan pakai').selectOption('gram')
    await field('Satuan pembelian').selectOption('pack')
    await field('Harga beli').fill('25000')
    await field('Isi per pembelian').fill('1000')
    await field('Stok minimum').fill('5')
    await field('Pemakaian standar per porsi').fill('37')
    await page.getByRole('button', { name: 'Tambah bahan', exact: true }).click()
    await settle(500)
    store = await readStore()
    const createdIngredient = store.ingredients.find((item: any) => item.name === 'Bahan Uji UI')
    check('bahan dibuat', Boolean(createdIngredient))
    check('pemakaian standar bahan tersimpan', createdIngredient ? store.settings.ingredientUsage?.[createdIngredient.id] === 37 : false, JSON.stringify(store.settings.ingredientUsage))

    // ---------- 1a. Isi pemakaian standar beberapa bahan sekaligus ----------
    await page.getByRole('button', { name: 'Atur standar', exact: true }).click()
    await page.waitForSelector('.modal.editor')
    const standardDialog = page.locator('.modal.editor')
    check('dialog standar massal menyediakan input per bahan', (await standardDialog.locator('[aria-label^="Standar "]').count()) >= 10, String(await standardDialog.locator('[aria-label^="Standar "]').count()))
    check('standar yang sudah ada terisi saat dialog dibuka', (await page.locator('[aria-label="Standar Bahan Uji UI"]').inputValue()) === '37')
    const saveStandardBox = await page.getByRole('button', { name: 'Simpan standar' }).boundingBox()
    check('tombol simpan standar terlihat tanpa perlu menggulir', Boolean(saveStandardBox) && saveStandardBox!.y + saveStandardBox!.height <= 600, JSON.stringify(saveStandardBox))
    await page.locator('[aria-label="Standar Tepung bumbu"]').fill('42')
    await page.locator('[aria-label="Standar Saus BBQ"]').fill('12')
    await page.getByRole('button', { name: 'Batal', exact: true }).click()
    await settle(300)
    store = await readStore()
    check('batal tidak mengubah pemakaian standar', store.settings.ingredientUsage?.['tepung-bumbu'] === undefined, JSON.stringify(store.settings.ingredientUsage))

    await page.getByRole('button', { name: 'Atur standar', exact: true }).click()
    await page.waitForSelector('.modal.editor')
    await page.locator('[aria-label="Standar Tepung bumbu"]').fill('42')
    await page.locator('[aria-label="Standar Saus BBQ"]').fill('12')
    await shot('standar-massal')
    await page.getByRole('button', { name: 'Simpan standar' }).click()
    await settle(500)
    store = await readStore()
    check('dua standar tersimpan sekali simpan', store.settings.ingredientUsage?.['tepung-bumbu'] === 42 && store.settings.ingredientUsage?.['saus-bbq'] === 12, JSON.stringify(store.settings.ingredientUsage))
    check('kolom standar tampil di tabel bahan', (await page.locator('.owner-data tbody tr', { hasText: 'Tepung bumbu' }).first().innerText()).includes('42 gram'))
    await page.getByRole('button', { name: 'Atur standar', exact: true }).click()
    await page.waitForSelector('.modal.editor')
    check('nilai standar tampil lagi saat dialog dibuka', (await page.locator('[aria-label="Standar Tepung bumbu"]').inputValue()) === '42')
    await page.locator('[aria-label="Standar Saus BBQ"]').fill('')
    await page.getByRole('button', { name: 'Simpan standar' }).click()
    await settle(500)
    store = await readStore()
    check('mengosongkan sel menghapus standar bahan', store.settings.ingredientUsage?.['saus-bbq'] === undefined && store.settings.ingredientUsage?.['tepung-bumbu'] === 42, JSON.stringify(store.settings.ingredientUsage))

    const options = await page.locator('.purchase-form select option').evaluateAll((elements: HTMLOptionElement[]) => elements.map((option) => ({ value: option.value, label: option.textContent?.trim() ?? '' })))
    const picks = options.slice(0, 3)
    const before: { label: string; text: string; value: number }[] = []
    for (const pick of picks) before.push({ label: pick.label, ...(await stockCell(pick.label.split(' (')[0])) })
    for (const pick of picks) {
      await page.locator('.purchase-form select').selectOption(pick.value)
      await page.locator('[aria-label="Jumlah pembelian"]').fill('10')
      await page.locator('[aria-label="Total biaya pembelian"]').fill('5000')
      await page.getByRole('button', { name: 'Tambah baris' }).click()
      await settle(140)
    }
    const draftRows = page.locator('.owner-table-wrap').filter({ has: page.locator('.purchase-total') }).locator('tbody tr')
    check('draft pembelian berisi 3 baris', (await draftRows.count()) === 3, String(await draftRows.count()))
    await page.locator('.purchase-total').scrollIntoViewIfNeeded()
    await shot('bulk-pembelian')
    await page.getByRole('button', { name: /Simpan 3 pembelian/ }).click()
    await settle(700)
    store = await readStore()
    check('3 pembelian tersimpan sekali simpan', store.stockMovements.filter((movement: any) => movement.type === 'purchase').length >= 3, String(store.stockMovements.filter((movement: any) => movement.type === 'purchase').length))
    const after: { label: string; text: string; value: number }[] = []
    for (const pick of picks) after.push({ label: pick.label, ...(await stockCell(pick.label.split(' (')[0])) })
    const deltas = before.map((entry, index) => after[index].value - entry.value)
    check('stok 3 bahan bertambah +10', deltas.every((delta) => delta === 10), `${before.map((entry) => entry.text).join(' / ')} → ${after.map((entry) => entry.text).join(' / ')}`)

    // ---------- 4b. Opname: hapus wajib lewat dialog konfirmasi in-app ----------
    await page.getByRole('button', { name: 'Opname baru' }).first().click()
    await page.waitForSelector('.modal.owner-modal')
    await page.locator('[aria-label="Stok fisik"]').fill('7')
    await page.getByRole('button', { name: 'Simpan opname' }).click()
    await settle(500)
    store = await readStore()
    check('opname tersimpan dari UI', store.stockMovements.some((movement: any) => movement.type === 'opname'))
    check('opname tampil di riwayat', (await page.locator('.owner-opname-row').count()) >= 1)
    await page.locator('.owner-opname-row').first().getByRole('button', { name: 'Hapus', exact: true }).click()
    await page.waitForSelector('.owner-confirm')
    store = await readStore()
    check('hapus opname membuka dialog konfirmasi di aplikasi', (await page.locator('.owner-confirm').count()) === 1)
    check('opname belum terhapus sebelum konfirmasi', store.stockMovements.some((movement: any) => movement.type === 'opname'))
    await shot('hapus-opname-konfirmasi')
    await page.locator('.owner-confirm').getByRole('button', { name: 'Batal' }).click()
    await settle(300)
    store = await readStore()
    check('batal tidak menghapus opname', store.stockMovements.some((movement: any) => movement.type === 'opname'))
    await page.locator('.owner-opname-row').first().getByRole('button', { name: 'Hapus', exact: true }).click()
    await page.waitForSelector('.owner-confirm')
    await page.getByRole('button', { name: 'Hapus catatan opname' }).click()
    await settle(500)
    store = await readStore()
    check('opname terhapus setelah konfirmasi', !store.stockMovements.some((movement: any) => movement.type === 'opname'))

    await page.locator('.owner-data tbody tr', { hasText: 'Bahan Uji UI' }).first().getByRole('button', { name: 'Edit' }).click()
    await page.waitForSelector('.modal')
    await field('Stok minimum').fill('99')
    await page.getByRole('button', { name: 'Simpan', exact: true }).click()
    await settle(500)
    store = await readStore()
    check('bahan diedit (stok minimum 99)', store.ingredients.find((item: any) => item.name === 'Bahan Uji UI')?.minStock === 99)

    // ---------- 1b. Jumlah resep terisi otomatis dari pemakaian standar ----------
    await navTo('Menu & HPP')
    await page.locator('.owner-menu-card').first().getByRole('button', { name: 'Edit' }).click()
    await page.waitForSelector('.modal.editor')
    await page.getByRole('button', { name: 'Tambah bahan', exact: true }).click()
    await settle(250)
    const lastRecipeRow = page.locator('.recipe-row').last()
    const ingredientOption = lastRecipeRow.locator('select option', { hasText: 'Bahan Uji UI' }).first()
    const ingredientOptionValue = await ingredientOption.getAttribute('value')
    check('bahan uji muncul sebagai pilihan resep', Boolean(ingredientOptionValue))
    if (ingredientOptionValue) await lastRecipeRow.locator('select').selectOption(ingredientOptionValue)
    await settle(250)
    const autoQty = await lastRecipeRow.locator('input[type=number]').inputValue()
    check('jumlah resep terisi otomatis dari pemakaian standar', autoQty === '37', autoQty)
    await page.getByRole('button', { name: 'Tambah bahan', exact: true }).click()
    await settle(250)
    const bulkRecipeRow = page.locator('.recipe-row').last()
    const tepungOptionValue = await bulkRecipeRow.locator('select option', { hasText: 'Tepung bumbu' }).first().getAttribute('value')
    if (tepungOptionValue) await bulkRecipeRow.locator('select').selectOption(tepungOptionValue)
    await settle(250)
    check('standar hasil isi massal dipakai resep menu', (await bulkRecipeRow.locator('input[type=number]').inputValue()) === '42', await bulkRecipeRow.locator('input[type=number]').inputValue())
    await shot('resep-otomatis')
    await page.locator('.modal.editor').getByRole('button', { name: 'Batal' }).click()
    await settle(300)
    await navTo('Bahan & stok')
    await page.locator('.owner-data tbody tr', { hasText: 'Bahan Uji UI' }).first().getByRole('button', { name: /Hapus/ }).click()
    await page.waitForSelector('.owner-confirm')
    store = await readStore()
    check('hapus bahan membuka dialog konfirmasi di aplikasi', (await page.locator('.owner-confirm').count()) === 1)
    check('bahan belum terhapus sebelum konfirmasi', Boolean(store.ingredients.find((item: any) => item.name === 'Bahan Uji UI')))
    await shot('hapus-bahan-konfirmasi')
    await page.getByRole('button', { name: 'Hapus bahan', exact: true }).click()
    await settle(500)
    store = await readStore()
    check('bahan dihapus', !store.ingredients.some((item: any) => item.name === 'Bahan Uji UI'))
    check('dialog konfirmasi tertutup setelah hapus', (await page.locator('.owner-confirm').count()) === 0)

    // Bahan yang dipakai resep: hapus lewat jalur eksplisit "lepas dari resep".
    await page.locator('[aria-label="Cari bahan"]').fill('Saus BBQ')
    await settle(200)
    store = await readStore()
    check('menu bbq memakai saus bbq sebelum dihapus', Boolean(store.menus.find((menu: any) => menu.id === 'bbq')?.recipe.some((line: any) => line.ingredientId === 'saus-bbq')))
    await page.locator('.owner-data tbody tr', { hasText: 'Saus BBQ' }).first().getByRole('button', { name: /Hapus/ }).click()
    await page.waitForSelector('.owner-confirm')
    const usedDialog = await page.locator('.owner-confirm').innerText()
    check('dialog menyebut bahan dipakai resep menu', usedDialog.includes('dipakai 1 menu') && usedDialog.includes('Rice Bowl BBQ 650'), usedDialog.replace(/\s+/g, ' ').slice(0, 180))
    await shot('hapus-bahan-dipakai-resep')
    await page.getByRole('button', { name: 'Hapus & lepas dari resep' }).click()
    await settle(600)
    store = await readStore()
    check('bahan yang dipakai resep bisa dihapus', !store.ingredients.some((item: any) => item.id === 'saus-bbq'))
    check('resep menu ikut dilepas saat bahan dihapus', !store.menus.find((menu: any) => menu.id === 'bbq')?.recipe.some((line: any) => line.ingredientId === 'saus-bbq'))
    await page.locator('[aria-label="Cari bahan"]').fill('')

    // ---------- 2. Kategori ----------
    await navTo('Kategori')
    await page.locator('[aria-label="Nama kategori baru"]').first().fill('Kategori Uji UI')
    await page.getByRole('button', { name: 'Tambah kategori' }).first().click()
    await settle(400)
    store = await readStore()
    check('kategori ditambahkan', store.categories.some((category: any) => category.name === 'Kategori Uji UI'))
    await shot('kategori')
    await backToPos()
    check('kategori muncul di strip kasir', (await page.locator('.category-row').innerText()).includes('Kategori Uji UI'))
    await enterOwner()
    await navTo('Kategori')
    await page.locator('.owner-category-row', { hasText: 'Kategori Uji UI' }).first().getByRole('button', { name: 'Ubah' }).click()
    await page.locator('.modal input').first().fill('Kategori Uji UI 2')
    await page.locator('.modal').getByRole('button', { name: 'Simpan' }).click()
    await settle(400)
    store = await readStore()
    check('kategori diubah', store.categories.some((category: any) => category.name === 'Kategori Uji UI 2') && !store.categories.some((category: any) => category.name === 'Kategori Uji UI'))
    await backToPos()
    check('strip kasir memakai nama kategori baru', (await page.locator('.category-row').innerText()).includes('Kategori Uji UI 2'))
    await enterOwner()
    await navTo('Kategori')
    const usedCategory = page.locator('.owner-category-row', { hasText: 'Paket' }).first()
    check('kategori terpakai tidak bisa dihapus', await usedCategory.getByRole('button', { name: 'Hapus' }).isDisabled())
    await page.locator('.owner-category-row', { hasText: 'Kategori Uji UI 2' }).first().getByRole('button', { name: 'Hapus' }).click()
    await page.waitForSelector('.owner-confirm')
    store = await readStore()
    check('hapus kategori membuka dialog konfirmasi di aplikasi', (await page.locator('.owner-confirm').count()) === 1)
    check('kategori belum terhapus sebelum konfirmasi', Boolean(store.categories.find((category: any) => category.name === 'Kategori Uji UI 2')))
    await shot('hapus-kategori-konfirmasi')
    await page.locator('.owner-confirm').getByRole('button', { name: 'Batal' }).click()
    await settle(300)
    store = await readStore()
    check('batal tidak menghapus kategori', Boolean(store.categories.find((category: any) => category.name === 'Kategori Uji UI 2')))
    await page.locator('.owner-category-row', { hasText: 'Kategori Uji UI 2' }).first().getByRole('button', { name: 'Hapus' }).click()
    await page.waitForSelector('.owner-confirm')
    await page.getByRole('button', { name: 'Hapus kategori' }).click()
    await settle(400)
    store = await readStore()
    check('kategori tak terpakai bisa dihapus', !store.categories.some((category: any) => category.name === 'Kategori Uji UI 2'))

    // ---------- 6. Pengaturan printer: persist + jalur cetak ----------
    await navTo('Pengaturan')
    await page.getByRole('button', { name: '80 mm' }).click()
    await page.locator('[aria-label="Cetak 2 salinan"]').click()
    await page.locator('.owner-field', { hasText: 'Baris promo struk' }).locator('textarea').fill('Promo hari ini\nBeli 2 gratis 1')
    await page.locator('.printer-grid').scrollIntoViewIfNeeded()
    await shot('pengaturan-printer')
    await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
    await settle(600)
    store = await readStore()
    check('pengaturan printer tersimpan', store.settings.printer.paperWidth === 80 && store.settings.printer.copies === 2, JSON.stringify(store.settings.printer))
    check('baris promo struk tersimpan', store.settings.receiptPromo === 'Promo hari ini\nBeli 2 gratis 1', JSON.stringify(store.settings.receiptPromo))

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.pos-screen', { timeout: 30_000 })
    await settle(800)
    await enterOwner()
    await navTo('Pengaturan')
    const previewLabel = (await page.locator('.owner-preview-label').innerText()).toLowerCase()
    check('pengaturan printer persist setelah reload', previewLabel.includes('80 mm') && previewLabel.includes('2 salinan'), previewLabel)
    const previewText = await page.locator('.printer-preview').innerText()
    check('baris promo tampil di pratinjau struk', previewText.includes('Promo hari ini') && previewText.includes('Beli 2 gratis 1'), previewText.slice(-180))
    const settingsText = await page.locator('.owner-settings-grid').innerText()
    check('pengaturan menampilkan status aplikasi offline', settingsText.includes('Service worker') && settingsText.includes('Install ke layar utama'), settingsText.split('\n').filter((line) => /Service worker|Install ke layar utama/.test(line)).join(' | '))
    await installPrintCapture()
    await page.getByRole('button', { name: 'Tes cetak struk' }).click()
    await settle(500)
    const printHtml = await page.evaluate(() => (window as unknown as { __printHtml: string | null }).__printHtml)
    check('tes cetak memakai lebar 80 mm', Boolean(printHtml?.includes('size: 80mm')), printHtml ? 'HTML tercapture' : 'tidak ada HTML')
    check('tes cetak mengirim 2 salinan', (printHtml?.match(/<pre>/g) ?? []).length === 2, String((printHtml?.match(/<pre>/g) ?? []).length))
    check('tes cetak memuat baris promo', Boolean(printHtml?.includes('Promo hari ini') && printHtml?.includes('Beli 2 gratis 1')), printHtml ? 'HTML tercapture' : 'tidak ada HTML')
    await shot('pengaturan-reload')

    // ---------- 7. Buka shift → transaksi tunai → struk → tutup shift ----------
    await backToPos()
    await page.locator('.empty-cart .open-shift-inline').click()
    await page.waitForSelector('#opening-float')
    const openingFloat = Number(await page.locator('#opening-float').inputValue())
    check('form buka shift memakai float default', openingFloat === 350000, String(openingFloat))
    await page.locator('.modal').getByRole('button', { name: 'Buka shift', exact: true }).click()
    await settle(700)
    store = await readStore()
    const openShift = [...store.shifts].reverse().find((shift: any) => shift.status === 'open')
    check('shift dibuka', Boolean(openShift) && openShift.openingFloat === 350000, openShift ? `${openShift.id} float=${openShift.openingFloat}` : 'tidak ada')

    const payButton = page.getByRole('button', { name: /Proses pesanan/ })
    const firstCard = page.locator('.menu-card').first()
    const soldName = (await firstCard.locator('.menu-info strong').innerText()).trim()
    const soldPrice = Number((await firstCard.locator('.menu-info b').innerText()).replace(/[^0-9]/g, ''))
    await firstCard.click()
    await settle(250)
    check('menu masuk keranjang', await page.locator('.cart-line').count() === 1, `${soldName} Rp${soldPrice}`)
    check('tombol Proses pesanan aktif setelah shift dibuka', await payButton.isEnabled())

    // Tahan → lanjutkan pesanan (CTA keranjang).
    await page.getByRole('button', { name: 'Tahan pesanan' }).click()
    await settle(350)
    store = await readStore()
    check('pesanan ditahan tersimpan', store.heldOrders.length === 1, `${store.heldOrders.length} pesanan`)
    check('keranjang dikosongkan setelah tahan pesanan', await page.locator('.cart-line').count() === 0)
    await page.locator('[aria-label="Pesanan ditahan"]').click()
    await page.waitForSelector('.held-row')
    await page.getByRole('button', { name: 'Lanjutkan', exact: true }).click()
    await settle(350)
    store = await readStore()
    check('pesanan ditahan dilanjutkan ke keranjang', await page.locator('.cart-line').count() === 1 && store.heldOrders.length === 0)

    await payButton.click()
    await page.waitForSelector('.modal .payment-grid')
    await page.locator('.modal .cash-input[type=number]').fill('1')
    check('tombol bayar tunai terkunci saat uang kurang', await page.getByRole('button', { name: /Bayar & cetak struk/ }).isDisabled())
    check('peringatan uang kurang terlihat', await page.locator('.cash-short').count() === 1)
    await page.locator('.exact-cash').click()
    check('tombol bayar aktif setelah uang pas', await page.getByRole('button', { name: /Bayar & cetak struk/ }).isEnabled())
    await installPrintCapture()
    await page.getByRole('button', { name: /Bayar & cetak struk/ }).click()
    await settle(800)
    store = await readStore()
    const cashSale = [...store.transactions].reverse().find((transaction: any) => transaction.shiftId === openShift?.id)
    check('transaksi tunai tersimpan di shift aktif', Boolean(cashSale) && cashSale.paymentMethod === 'Cash' && cashSale.subtotal === soldPrice, cashSale ? `${cashSale.number} Rp${cashSale.subtotal}` : 'tidak ada')
    check('pembayaran uang pas tanpa kembalian', cashSale?.paidAmount === soldPrice && cashSale?.change === 0, `bayar=${cashSale?.paidAmount} kembali=${cashSale?.change}`)
    check('keranjang dikosongkan setelah bayar', await page.locator('.cart-line').count() === 0)

    // QRIS: transaksi tercatat sebagai non-cash.
    await firstCard.click()
    await settle(250)
    await payButton.click()
    await page.waitForSelector('.modal .payment-grid')
    await page.locator('.payment', { hasText: 'QRIS' }).click()
    await page.getByRole('button', { name: /Bayar & cetak struk/ }).click()
    await settle(700)
    store = await readStore()
    const qrisSale = [...store.transactions].reverse().find((transaction: any) => transaction.shiftId === openShift?.id && transaction.paymentMethod === 'QRIS')
    check('transaksi QRIS tersimpan', Boolean(qrisSale) && qrisSale.subtotal === soldPrice && qrisSale.paidAmount === soldPrice, qrisSale ? `${qrisSale.number} Rp${qrisSale.subtotal}` : 'tidak ada')

    await page.locator('[aria-label="Riwayat transaksi"]').click()
    await page.waitForSelector('.history-row')
    await page.locator('.history-row').first().click()
    await page.waitForSelector('.receipt')
    check('detail struk transaksi terbuka', (await page.locator('.receipt').innerText()).includes(soldName))
    await installPrintCapture()
    await page.locator('.detail-action.primary').click()
    await settle(600)
    const receiptHtml = await page.evaluate(() => (window as unknown as { __printHtml: string | null }).__printHtml)
    check('struk transaksi tercetak (HTML)', Boolean(receiptHtml) && receiptHtml!.includes(soldName), receiptHtml ? 'HTML tercapture' : 'tidak ada HTML')
    check('struk memuat total transaksi', Boolean(receiptHtml?.includes(`Rp${soldPrice.toLocaleString('id-ID')}`)), `Rp${soldPrice.toLocaleString('id-ID')}`)
    check('struk memakai 80 mm + 2 salinan', Boolean(receiptHtml?.includes('size: 80mm')) && (receiptHtml?.match(/<pre>/g) ?? []).length === 2, 'dari pengaturan tersimpan')
    await shot('struk-transaksi')

    // Void transaksi QRIS dengan alasan dan PIN pemilik.
    await page.locator('.void-reason').fill('Uji void QRIS')
    await page.getByRole('button', { name: 'Void', exact: true }).click()
    await page.waitForSelector('.pin-modal', { timeout: 10_000 })
    await page.locator('input[aria-label="PIN pemilik"]').fill('1234')
    await page.getByRole('button', { name: 'Buka', exact: true }).click()
    await settle(700)
    store = await readStore()
    const voidedSale = store.transactions.find((transaction: any) => transaction.id === qrisSale?.id)
    check('void transaksi tersimpan', voidedSale?.status === 'cancelled', voidedSale?.status ?? 'tidak ada')
    check('alasan void tersimpan', voidedSale?.statusReason === 'Uji void QRIS', voidedSale?.statusReason ?? 'tidak ada')
    await page.locator('.modal-close').first().click()
    await settle(300)

    // Cash out memengaruhi kas seharusnya.
    await page.locator('[aria-label="Menu"]').click()
    await page.waitForSelector('.more-actions')
    await page.getByRole('button', { name: 'Cash in/out' }).click()
    await page.getByRole('button', { name: 'Cash out', exact: true }).click()
    await page.getByPlaceholder('Nominal').fill('5000')
    await page.getByPlaceholder('Catatan wajib, misalnya: beli es batu').fill('Uji cash out')
    await page.getByRole('button', { name: 'Simpan cash movement' }).click()
    await settle(500)
    store = await readStore()
    const cashOut = [...store.cashMovements].reverse().find((movement: any) => movement.shiftId === openShift?.id && movement.type === 'out')
    check('cash out tersimpan di shift aktif', cashOut?.amount === 5000 && cashOut?.note === 'Uji cash out', cashOut ? `${cashOut.type} Rp${cashOut.amount}` : 'tidak ada')

    // Pre-order QRIS: DP 50%, mulai proses, lalu pelunasan tanpa menambah kas fisik.
    await firstCard.click()
    await page.getByRole('button', { name: 'Pre-order + DP' }).click()
    await page.waitForSelector('.dp-presets')
    await page.getByPlaceholder('Nama pelanggan').fill('Uji Preorder')
    await page.getByPlaceholder('Jam pengambilan').fill('2026-10-29T10:00')
    await page.locator('.payment', { hasText: 'QRIS' }).click()
    await page.locator('.dp-presets button').nth(1).click()
    await page.getByRole('button', { name: 'Simpan pre-order' }).click()
    await settle(600)
    store = await readStore()
    const preorder = store.preOrders.find((order: any) => order.customerName === 'Uji Preorder')
    check('pre-order QRIS tersimpan dengan DP 50%', preorder?.paymentMethod === 'QRIS' && preorder?.dp === Math.round(soldPrice / 2), preorder ? `${preorder.paymentMethod} DP ${preorder.dp}` : 'tidak ada')
    await page.locator('[aria-label="Daftar pre-order"]').click()
    await page.waitForSelector('.held-row')
    await page.getByRole('button', { name: 'Mulai proses' }).click()
    await settle(600)
    store = await readStore()
    const startedPreorder = store.preOrders.find((order: any) => order.customerName === 'Uji Preorder')
    const preorderSale = store.transactions.find((transaction: any) => transaction.id === startedPreorder?.transactionId)
    check('pre-order mulai diproses membuat penjualan', startedPreorder?.status === 'processing' && preorderSale?.paymentMethod === 'QRIS', startedPreorder?.status ?? 'tidak ada')
    await page.getByRole('button', { name: 'Pelunasan' }).click()
    await settle(600)
    store = await readStore()
    check('pre-order selesai setelah pelunasan', store.preOrders.find((order: any) => order.customerName === 'Uji Preorder')?.status === 'completed')
    check('pelunasan QRIS tidak menambah kas fisik', !store.cashMovements.some((movement: any) => movement.note === 'Pelunasan Uji Preorder'))
    await page.locator('.modal-close').first().click()
    await settle(300)

    await page.locator('[aria-label="Menu"]').click()
    await page.waitForSelector('.more-actions')
    await page.getByRole('button', { name: 'Tutup shift' }).click()
    const expectedText = (await page.locator('.summary-row', { hasText: 'Kas seharusnya' }).locator('b').innerText()).trim()
    const expectedCash = Number(expectedText.replace(/[^0-9]/g, ''))
    check('kas seharusnya = float + penjualan tunai - cash out', expectedCash === 350000 + soldPrice - 5000, `${expectedText} vs ${350000 + soldPrice - 5000}`)
    await page.locator('.modal input[type=number]').fill(String(expectedCash))
    await page.getByRole('button', { name: 'Konfirmasi tutup shift' }).click()
    await page.waitForSelector('.pin-modal', { timeout: 10_000 })
    await page.locator('input[aria-label="PIN pemilik"]').fill('1234')
    await page.getByRole('button', { name: 'Buka', exact: true }).click()
    await settle(1500)
    store = await readStore()
    const closedShift = store.shifts.find((shift: any) => shift.id === openShift?.id)
    check('shift ditutup dengan kas aktual', closedShift?.status === 'closed' && closedShift?.actualCash === expectedCash, `${closedShift?.status} kas=${closedShift?.actualCash}`)
    check('kasir kembali ke keadaan belum buka shift', (await page.locator('.empty-cart strong').innerText()).includes('Shift belum dibuka'))
    await shot('shift-ditutup')

    // ---------- 8. Guard hapus menu + fallback gambar rusak ----------
    const finalStore = await readStore()
    const soldMenu = finalStore.menus.find((menu: any) => menu.name === soldName)
    check('menu yang terjual ditemukan untuk uji guard', Boolean(soldMenu), soldName)
    if (soldMenu) {
      soldMenu.imageUrl = 'data:image/png;base64,AAAA'
      await writeStore(finalStore)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.pos-screen')
      await settle(600)

      const cashierSold = page.locator('.menu-card', { hasText: soldName }).first()
      await cashierSold.locator('.menu-emoji').waitFor({ timeout: 5000 })
      check('gambar gagal dimuat memakai placeholder di kasir', await cashierSold.locator('.menu-emoji').count() === 1)

      await enterOwner()
      await navTo('Menu & HPP')
      const ownerSold = page.locator('.owner-menu-card', { hasText: soldName }).first()
      await ownerSold.locator('.owner-menu-photo .menu-emoji').waitFor({ timeout: 5000 })
      check('gambar gagal dimuat memakai placeholder di mode pemilik', await ownerSold.locator('.owner-menu-photo .menu-emoji').count() === 1)

      await ownerSold.getByRole('button', { name: 'Edit' }).click()
      await page.waitForSelector('.modal.editor')
      await page.locator('.image-preview .image-fallback').waitFor({ timeout: 5000 })
      check('preview editor memakai placeholder saat gambar gagal', await page.locator('.image-preview .image-fallback').count() === 1)
      const soldUsage = finalStore.transactions.filter((transaction: any) => transaction.items.some((item: any) => item.id === soldMenu.id)).length
      const usageNote = await page.locator('.menu-usage-note').innerText()
      check('editor memperingatkan menu pernah dipakai transaksi', usageNote.includes(`${soldUsage} transaksi`), usageNote)

      await page.getByRole('button', { name: 'Hapus menu' }).click()
      await page.waitForSelector('.owner-confirm')
      const deleteDialogText = await page.locator('.owner-confirm').innerText()
      check('dialog hapus menu menyebut jumlah transaksi', deleteDialogText.includes(`${soldUsage} transaksi`), deleteDialogText.replace(/\s+/g, ' ').slice(0, 220))
      store = await readStore()
      check('menu yang dipakai transaksi belum terhapus sebelum konfirmasi', Boolean(store.menus.some((menu: any) => menu.name === soldName)))
      await shot('hapus-menu-dipakai-transaksi')
      await page.getByRole('button', { name: 'Hapus dari katalog' }).click()
      await settle(600)
      store = await readStore()
      check('menu yang dihapus hilang dari store', !store.menus.some((menu: any) => menu.name === soldName))
      await backToPos()
      check('menu yang dihapus hilang dari katalog kasir', await page.locator('.menu-card', { hasText: soldName }).count() === 0)
    }
  } catch (error) {
    check('alur UI selesai tanpa error tak terduga', false, error instanceof Error ? error.message.split('\n')[0] : String(error))
  }

  // ---------- Responsif: nol overflow horizontal ----------
  for (const viewport of [
    { name: '1024x600', width: 1024, height: 600 },
    { name: '1280x800', width: 1280, height: 800 },
    { name: '800x1280', width: 800, height: 1280 },
    { name: '360x640', width: 360, height: 640 },
  ]) {
    let sizeContext: BrowserContext | undefined
    try {
      if (!browser.isConnected()) throw new Error('Chromium berhenti sebelum uji responsif')
      sizeContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      const sizePage: Page = await sizeContext.newPage()
      await sizePage.goto(server.base, { waitUntil: 'domcontentloaded' })
      await sizePage.waitForSelector('.pos-screen', { timeout: 30_000 })
      await sizePage.waitForTimeout(500)
      const metrics = await sizePage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
      check(`tanpa overflow horizontal ${viewport.name}`, metrics.scrollWidth === metrics.clientWidth, `selisih=${metrics.scrollWidth - metrics.clientWidth}`)
      if (WITH_SHOTS) await sizePage.screenshot({ path: resolve(SHOTS, `overflow-${viewport.name}.png`) })
    } catch (error) {
      check(`viewport ${viewport.name} bisa dibuka`, false, error instanceof Error ? error.message.split('\n')[0] : String(error))
    } finally {
      await sizeContext?.close().catch(() => {})
    }
  }

  // ---------- 8. PWA: manifest, service worker, dan cold start offline ----------
  const built = await buildProductionBundle()
  check('build produksi untuk uji PWA', built)
  if (built) {
    const manifestFile = resolve(ROOT, 'dist/client/manifest.webmanifest')
    const serviceWorkerFile = resolve(ROOT, 'dist/client/sw.js')
    check('build memuat manifest PWA', existsSync(manifestFile))
    check('build memuat service worker', existsSync(serviceWorkerFile))
    if (existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { display?: string; start_url?: string; icons?: { sizes?: string; purpose?: string }[] }
        const icons = manifest.icons ?? []
        check(
          'manifest valid: standalone + ikon 192/512/maskable',
          manifest.display === 'standalone' && manifest.start_url === '/' && icons.some((icon) => icon.sizes === '192x192') && icons.some((icon) => icon.sizes === '512x512') && icons.some((icon) => icon.purpose === 'maskable'),
          `${manifest.display} • ${icons.length} ikon`,
        )
      } catch (error) {
        check('manifest valid: standalone + ikon 192/512/maskable', false, error instanceof Error ? error.message : String(error))
      }
    }
    let preview: StaticPreview | undefined
    let pwaContext: BrowserContext | undefined
    try {
      preview = await startStaticPreview()
      pwaContext = await browser.newContext({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      const pwaPage: Page = await pwaContext.newPage()
      await pwaPage.goto(preview.base, { waitUntil: 'domcontentloaded' })
      await pwaPage.waitForSelector('.pos-screen', { timeout: 30_000 })
      await pwaPage.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), undefined, { timeout: 20_000 })
      const cacheKeys = await pwaPage.evaluate(() => caches.keys())
      check('service worker aktif dan mengontrol halaman', cacheKeys.length > 0, `${cacheKeys.length} cache`)
      check('cache shell berversi dibuat', cacheKeys.some((key) => key.startsWith('sabana-pos-shell-')), cacheKeys.join(', '))
      await pwaContext.setOffline(true)
      await pwaPage.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 })
      await pwaPage.waitForSelector('.pos-screen', { timeout: 20_000 })
      check('shell kasir termuat setelah reload offline', (await pwaPage.title()).includes('Sabana POS'), await pwaPage.title())
      const offlineCards = await pwaPage.locator('.menu-card').count()
      check('katalog dirender dari cache saat offline', offlineCards > 0, `${offlineCards} menu`)
      await pwaPage.locator('.empty-cart .open-shift-inline').click()
      await pwaPage.waitForSelector('#opening-float', { timeout: 10_000 })
      check('modal buka shift terbuka saat offline', true)
      await pwaPage.locator('.modal').getByRole('button', { name: 'Buka shift', exact: true }).click()
      await pwaPage.waitForTimeout(500)
      await pwaPage.locator('.menu-card').first().click()
      check('menu bisa dipilih saat offline', await pwaPage.locator('.cart-line').count() === 1)
      if (WITH_SHOTS) await pwaPage.screenshot({ path: resolve(SHOTS, 'pwa-offline.png') })
      await pwaContext.setOffline(false)
    } catch (error) {
      check('skenario PWA offline selesai', false, error instanceof Error ? error.message.split('\n')[0] : String(error))
    } finally {
      await pwaContext?.close().catch(() => {})
      preview?.stop()
    }
  }

  check('tidak ada error React/konsol', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  server.stop()

  const failed = checks.filter((entry) => !entry.ok)
  const exitCode = failed.length > 0 ? 1 : 0
  writeReport(exitCode)
  console.log(`\n${checks.length - failed.length}/${checks.length} pemeriksaan UI lolos`)
  if (failed.length > 0) {
    console.error(`${failed.length} pemeriksaan gagal`)
    for (const entry of failed) console.error(`  ✖ ${entry.name}: ${entry.detail}`)
    return 1
  }
  console.log('Semua pemeriksaan UI lolos')
  return 0
}

const code = await main().catch((error: unknown) => {
  console.error(`✖ check:ui gagal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  return 1
})
process.exit(code)
