import { useEffect, useState } from 'react'
import { Bluetooth, DatabaseBackup, LogOut, Printer, RefreshCw, Save, Smartphone, Store, SwatchBook, Unplug } from 'lucide-react'

import type { AppSettings, ReceiptAlign, ReceiptFontSize, ThemeMode } from '../../domain/settings'
import {
  disconnectPrinter as disconnectActivePrinter,
  getPrinterTransportStatus,
  pairPrinter as pairActivePrinter,
  reconnectPrinter as reconnectActivePrinter,
  type PrinterConnectionStatus,
} from '../../lib/printer-connection'
import { createId } from '../../lib/id'
import { isOnlineMode, signOutOnline } from '../../lib/online'
import { getPwaStatus, hydratePwaStatus, promptPwaInstall, subscribePwaStatus, type PwaStatus } from '../../lib/pwa'
import { buildTestReceiptText, printOutcomeMessage, printTestReceiptPreferred } from '../../lib/receipt'
import type { OwnerTabProps } from './types'
import { Field, FieldGroup } from './ui'

export function SettingsTab({ store, setStore, notify, goTab }: OwnerTabProps) {
  const [businessName, setBusinessName] = useState(store.settings.businessName)
  const [outletName, setOutletName] = useState(store.settings.outletName)
  const [outletPhone, setOutletPhone] = useState(store.settings.outletPhone)
  const [receiptFooter, setReceiptFooter] = useState(store.settings.receiptFooter)
  const [receiptPromo, setReceiptPromo] = useState(store.settings.receiptPromo)
  const [theme, setTheme] = useState<ThemeMode>(store.settings.theme)
  const [deviceName, setDeviceName] = useState(store.settings.printer.deviceName)
  const [paperWidth, setPaperWidth] = useState<58 | 80>(store.settings.printer.paperWidth)
  const [autoPrint, setAutoPrint] = useState(store.settings.printer.autoPrint)
  const [headerAlign, setHeaderAlign] = useState<ReceiptAlign>(store.settings.printer.headerAlign)
  const [footerAlign, setFooterAlign] = useState<ReceiptAlign>(store.settings.printer.footerAlign)
  const [fontSize, setFontSize] = useState<ReceiptFontSize>(store.settings.printer.fontSize)
  const [showOrderType, setShowOrderType] = useState(store.settings.printer.showOrderType)
  const [showPaymentDetail, setShowPaymentDetail] = useState(store.settings.printer.showPaymentDetail)
  const [copies, setCopies] = useState(store.settings.printer.copies)
  const [printerStatus, setPrinterStatus] = useState<PrinterConnectionStatus>(() => getPrinterTransportStatus())
  const [printerBusy, setPrinterBusy] = useState(false)
  const [pwa, setPwa] = useState<PwaStatus>(() => getPwaStatus())
  const online = isOnlineMode()

  useEffect(() => { setTheme(store.settings.theme) }, [store.settings.theme])
  useEffect(() => {
    void hydratePwaStatus()
    return subscribePwaStatus(setPwa)
  }, [])

  const dirty = businessName !== store.settings.businessName
    || outletName !== store.settings.outletName
    || outletPhone !== store.settings.outletPhone
    || receiptFooter !== store.settings.receiptFooter
    || receiptPromo !== store.settings.receiptPromo
    || theme !== store.settings.theme
    || deviceName !== store.settings.printer.deviceName
    || paperWidth !== store.settings.printer.paperWidth
    || autoPrint !== store.settings.printer.autoPrint
    || headerAlign !== store.settings.printer.headerAlign
    || footerAlign !== store.settings.printer.footerAlign
    || fontSize !== store.settings.printer.fontSize
    || showOrderType !== store.settings.printer.showOrderType
    || showPaymentDetail !== store.settings.printer.showPaymentDetail
    || copies !== store.settings.printer.copies

  const receiptLayout = {
    businessName,
    outletName,
    outletPhone,
    footer: receiptFooter,
    promo: receiptPromo,
    paperWidth,
    headerAlign,
    footerAlign,
    fontSize,
    showOrderType,
    showPaymentDetail,
    copies,
  }
  const fontSizeLabel = fontSize === 'compact' ? 'kecil' : fontSize === 'large' ? 'besar' : 'normal'

  const save = () => {
    if (!businessName.trim()) { notify('Nama usaha wajib diisi'); return }
    if (!outletName.trim()) { notify('Nama outlet wajib diisi'); return }
    const settings: AppSettings = {
      businessName: businessName.trim(),
      outletName: outletName.trim(),
      outletPhone: outletPhone.trim(),
      receiptFooter: receiptFooter.trim() || 'Terima kasih',
      receiptPromo: receiptPromo.trim(),
      ingredientUsage: store.settings.ingredientUsage ?? {},
      theme,
      printer: {
        deviceName: deviceName.trim(),
        paperWidth,
        autoPrint,
        headerAlign,
        footerAlign,
        fontSize,
        showOrderType,
        showPaymentDetail,
        copies,
      },
    }
    setStore((current) => ({
      ...current,
      settings,
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'settings_update' as const, detail: `Printer ${paperWidth}mm • font ${fontSize} • ${copies} salinan • auto print ${autoPrint ? 'aktif' : 'nonaktif'}` }],
    }))
    notify('Pengaturan aplikasi disimpan')
  }

  const refreshPrinterStatus = () => {
    const next = getPrinterTransportStatus()
    setPrinterStatus(next)
    return next
  }

  const rememberPrinter = (name: string) => {
    setDeviceName(name)
    setStore((current) => ({
      ...current,
      settings: { ...current.settings, printer: { ...current.settings.printer, deviceName: name } },
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'settings_update' as const, detail: `Printer ${name} terhubung` }],
    }))
  }

  const pairPrinter = async () => {
    if (!printerStatus.canPair) { notify(printerStatus.diagnostic); return }
    setPrinterBusy(true)
    try {
      const printer = await pairActivePrinter()
      rememberPrinter(printer.deviceName)
      const next = refreshPrinterStatus()
      notify(`${printer.deviceName} terhubung • ${next.label}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Gagal memasangkan printer')
    } finally {
      setPrinterBusy(false)
    }
  }

  const reconnectPrinter = async () => {
    if (!printerStatus.canReconnect) { notify(printerStatus.diagnostic); return }
    setPrinterBusy(true)
    try {
      const printer = await reconnectActivePrinter(deviceName.trim())
      rememberPrinter(printer.deviceName)
      const next = refreshPrinterStatus()
      notify(`${printer.deviceName} terhubung kembali • ${next.label}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Gagal menghubungkan ulang printer')
    } finally {
      setPrinterBusy(false)
    }
  }

  const disconnectPrinter = async () => {
    setPrinterBusy(true)
    try {
      await disconnectActivePrinter()
      refreshPrinterStatus()
      notify('Printer diputuskan')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Gagal memutuskan printer')
    } finally {
      setPrinterBusy(false)
    }
  }

  const testPrint = async () => {
    const outcome = await printTestReceiptPreferred(receiptLayout)
    notify(printOutcomeMessage(outcome))
    // Auto-connect native dapat mengubah status tanpa pairing ulang.
    refreshPrinterStatus()
  }

  const installPwa = async () => {
    const outcome = await promptPwaInstall()
    if (outcome === 'accepted') notify('Aplikasi dipasang ke layar utama')
    else if (outcome === 'dismissed') notify('Pemasangan dibatalkan')
    else notify('Gunakan menu Chrome ⋮ → Instal aplikasi / Tambahkan ke layar utama')
  }

  return (
    <>
      <div className="owner-settings-grid">
        <section className="owner-settings-card">
          <div className="owner-setting-head"><span className="owner-stat-icon"><Store size={17} /></span><div><h2>Identitas outlet</h2><p className="owner-muted">Tampil di topbar dan struk pelanggan.</p></div></div>
          <Field label="Nama usaha"><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="SABANA FRIED CHICKEN" /></Field>
          <Field label="Nama outlet"><input value={outletName} onChange={(event) => setOutletName(event.target.value)} placeholder="Outlet utama" /></Field>
          <Field label="Nomor telepon outlet" hint="Tampil di bawah nama outlet dan pada struk pelanggan."><input type="tel" value={outletPhone} onChange={(event) => setOutletPhone(event.target.value)} placeholder="0812-3456-7890" /></Field>
          <Field label="Catatan kaki struk" hint="Mis. ucapan terima kasih atau nomor WhatsApp outlet."><textarea className="owner-textarea" value={receiptFooter} onChange={(event) => setReceiptFooter(event.target.value)} rows={3} /></Field>
          <Field label="Baris promo struk" hint="Opsional. Satu baris per baris, maksimal 3 baris; tampil di bawah catatan kaki, teks panjang dibungkus dan tetap di tengah."><textarea className="owner-textarea" value={receiptPromo} onChange={(event) => setReceiptPromo(event.target.value)} rows={2} placeholder="Promo: Beli 2 gratis 1" /></Field>
        </section>

        <section className="owner-settings-card">
          <div className="owner-setting-head"><span className="owner-stat-icon"><SwatchBook size={17} /></span><div><h2>Tampilan</h2><p className="owner-muted">Tema berlaku untuk kasir dan mode pemilik setelah disimpan.</p></div></div>
          <FieldGroup label="Tema aplikasi">
            <div className="owner-segment">
              <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>Terang</button>
              <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>Gelap</button>
            </div>
          </FieldGroup>
          <p className="owner-muted">Gunakan tombol tema di topbar untuk berganti cepat tanpa membuka pengaturan.</p>
          <div className="owner-setting-note">
            <strong>Kontras</strong>
            <span>Mode terang memakai teks hitam, mode gelap memakai teks putih agar tetap nyaman dibaca.</span>
          </div>
        </section>

        <section className="owner-settings-card wide">
          <div className="owner-setting-head"><span className="owner-stat-icon"><Printer size={17} /></span><div><h2>Printer & struk</h2><p className="owner-muted">Pasangkan printer thermal Bluetooth, atur tata letak, lalu uji struk sebelum dipakai di kasir.</p></div></div>

          <div className="printer-pair">
            <div className="printer-pair-head">
              <span className={printerStatus.connected ? 'owner-pill ok' : 'owner-pill'}>{printerStatus.connected ? 'TERHUBUNG' : 'BELUM TERHUBUNG'}</span>
              <div>
                <strong>{printerStatus.deviceName ?? (deviceName.trim() || 'Belum ada printer')}</strong>
                <small>Transport aktif: {printerStatus.label}</small>
              </div>
            </div>
            <p className="owner-muted">{printerStatus.diagnostic}</p>
            <div className="printer-pair-actions">
              <button type="button" className="owner-primary" onClick={pairPrinter} disabled={!printerStatus.canPair || printerBusy}><Bluetooth size={14} /> {printerBusy ? 'Menghubungkan…' : 'Cari & pasangkan'}</button>
              <button type="button" className="owner-ghost" onClick={reconnectPrinter} disabled={!printerStatus.canReconnect || printerBusy}><RefreshCw size={14} /> Hubungkan ulang</button>
              {printerStatus.canDisconnect && <button type="button" className="owner-ghost danger" onClick={disconnectPrinter} disabled={printerBusy}><Unplug size={14} /> Putuskan</button>}
            </div>
            <div className="owner-setting-note">
              <strong>Transport & pairing</strong>
              <span>{printerStatus.kind === 'native' ? 'Bridge native aktif. Printer BLE maupun Classic/SPP ditangani shell Android; aplikasi web hanya mengirim payload ESC/POS.' : printerStatus.kind === 'web-bluetooth' ? 'Web Bluetooth aktif di Chrome/Edge (HTTPS). Hanya printer BLE yang didukung; printer Classic/SPP memerlukan bridge native.' : 'Runtime ini hanya bisa membuka dialog cetak sistem. Untuk pairing langsung, jalankan di Chrome/Edge Android atau pasang shell Android dengan bridge native.'}</span>
            </div>
            <div className="owner-setting-note">
              <strong>Panduan pairing RPP02N</strong>
              <span>Nyalakan printer → tekan <b>Cari &amp; pasangkan</b> → pilih <b>RPP02N</b> → tunggu status <b>TERHUBUNG</b> → <b>Tes cetak struk</b> → <b>Simpan pengaturan</b>. Pairing dilakukan dari Chrome di tablet (HTTPS) atau dari APK Sabana POS, bukan dari preview desktop. Jika RPP02N tidak muncul di daftar Classic, tekan <b>Pindai BLE</b> atau pasangkan dulu lewat Pengaturan Bluetooth Android.</span>
            </div>
          </div>

          <div className="printer-grid">
            <div>
              <Field label="Nama printer" hint="Terisi otomatis saat pairing; bisa juga diisi manual sebagai catatan kasir."><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Thermal Kasir 1" /></Field>
              <Field label="Tipe koneksi" hint="Ditentukan otomatis dari runtime (native, Web Bluetooth, atau dialog cetak).">
                <input value={printerStatus.label} readOnly aria-label="Tipe koneksi printer" />
              </Field>
              <FieldGroup label="Lebar kertas">
                <div className="owner-segment">
                  <button type="button" className={paperWidth === 58 ? 'active' : ''} onClick={() => setPaperWidth(58)}>58 mm</button>
                  <button type="button" className={paperWidth === 80 ? 'active' : ''} onClick={() => setPaperWidth(80)}>80 mm</button>
                </div>
              </FieldGroup>
              <FieldGroup label="Setelah pembayaran">
                <button type="button" className={autoPrint ? 'owner-toggle active owner-toggle-wide' : 'owner-toggle owner-toggle-wide'} onClick={() => setAutoPrint((value) => !value)}>{autoPrint ? 'Cetak struk otomatis' : 'Tidak cetak otomatis'}</button>
              </FieldGroup>

              <div className="printer-layout">
                <h3>Tata letak struk</h3>
                <div className="printer-layout-grid">
                  <FieldGroup label="Perataan header">
                    <div className="owner-segment">
                      <button type="button" aria-label="Header struk kiri" className={headerAlign === 'left' ? 'active' : ''} onClick={() => setHeaderAlign('left')}>Kiri</button>
                      <button type="button" aria-label="Header struk tengah" className={headerAlign === 'center' ? 'active' : ''} onClick={() => setHeaderAlign('center')}>Tengah</button>
                    </div>
                  </FieldGroup>
                  <FieldGroup label="Perataan footer">
                    <div className="owner-segment">
                      <button type="button" aria-label="Footer struk kiri" className={footerAlign === 'left' ? 'active' : ''} onClick={() => setFooterAlign('left')}>Kiri</button>
                      <button type="button" aria-label="Footer struk tengah" className={footerAlign === 'center' ? 'active' : ''} onClick={() => setFooterAlign('center')}>Tengah</button>
                    </div>
                  </FieldGroup>
                  <FieldGroup label="Ukuran font">
                    <div className="owner-segment three">
                      <button type="button" aria-label="Font struk kecil" className={fontSize === 'compact' ? 'active' : ''} onClick={() => setFontSize('compact')}>Kecil</button>
                      <button type="button" aria-label="Font struk normal" className={fontSize === 'normal' ? 'active' : ''} onClick={() => setFontSize('normal')}>Normal</button>
                      <button type="button" aria-label="Font struk besar" className={fontSize === 'large' ? 'active' : ''} onClick={() => setFontSize('large')}>Besar</button>
                    </div>
                  </FieldGroup>
                  <FieldGroup label="Salinan struk">
                    <div className="owner-segment three">
                      {[1, 2, 3].map((value) => <button type="button" key={value} aria-label={`Cetak ${value} salinan`} className={copies === value ? 'active' : ''} onClick={() => setCopies(value)}>{value}×</button>)}
                    </div>
                  </FieldGroup>
                </div>
                <FieldGroup label="Isi struk">
                  <div className="printer-toggle-row">
                    <button type="button" aria-pressed={showOrderType} className={showOrderType ? 'owner-toggle active' : 'owner-toggle'} onClick={() => setShowOrderType((value) => !value)}>Tipe pesanan</button>
                    <button type="button" aria-pressed={showPaymentDetail} className={showPaymentDetail ? 'owner-toggle active' : 'owner-toggle'} onClick={() => setShowPaymentDetail((value) => !value)}>Rincian pembayaran</button>
                  </div>
                </FieldGroup>
              </div>

              <button type="button" className="owner-ghost" onClick={testPrint}><Printer size={14} /> Tes cetak struk</button>
            </div>
            <div>
              <span className="owner-preview-label">Pratinjau {paperWidth} mm • {copies} salinan • font {fontSizeLabel}</span>
              <pre className="printer-preview" aria-label="Pratinjau struk">{buildTestReceiptText(receiptLayout)}</pre>
            </div>
          </div>
          <p className="owner-muted">Cetak memakai transport aktif di atas. Auto-print setelah pembayaran dan cetak ulang dari riwayat mengikuti transport yang sama; bila tidak ada printer terhubung, aplikasi membuka dialog cetak WebView/Android.</p>
        </section>

        <section className="owner-settings-card">
          <div className="owner-setting-head"><span className="owner-stat-icon"><DatabaseBackup size={17} /></span><div><h2>Data aplikasi</h2><p className="owner-muted">{online ? 'Tersimpan di Supabase untuk outlet ini.' : 'Tersimpan lokal di perangkat ini.'}</p></div></div>
          <div className="owner-metric-list">
            <div><span>Versi skema</span><b>{store.schemaVersion}</b></div>
            <div><span>Transaksi</span><b>{store.transactions.length}</b></div>
            <div><span>Menu</span><b>{store.menus.length}</b></div>
            <div><span>Bahan</span><b>{store.ingredients.length}</b></div>
            <div><span>Kategori</span><b>{store.categories.length}</b></div>
          </div>
          <button className="owner-ghost" onClick={() => goTab('backup')}><DatabaseBackup size={14} /> Buka backup & restore</button>
        </section>

        {online && <section className="owner-settings-card">
          <div className="owner-setting-head"><span className="owner-stat-icon"><LogOut size={17} /></span><div><h2>Akun cloud</h2><p className="owner-muted">Satu akun pemilik untuk satu outlet; tanpa manajemen staf atau pilihan outlet.</p></div></div>
          <button type="button" className="owner-ghost danger" onClick={() => { void signOutOnline().catch((error: unknown) => notify(error instanceof Error ? error.message : 'Gagal keluar dari akun')) }}><LogOut size={14} /> Keluar dari akun</button>
          <div className="owner-setting-note">
            <strong>Keamanan</strong>
            <span>Data dilindungi RLS. Jangan edit menu dari dua perangkat bersamaan — perubahan terakhir menang per baris.</span>
          </div>
        </section>}

        <section className="owner-settings-card">
          <div className="owner-setting-head"><span className="owner-stat-icon"><Smartphone size={17} /></span><div><h2>Aplikasi & offline</h2><p className="owner-muted">Shell aplikasi disimpan agar kasir tetap bisa dibuka tanpa jaringan.</p></div></div>
          <div className="owner-metric-list">
            <div><span>Service worker</span><b>{pwa.active ? 'Aktif' : pwa.production ? 'Belum aktif' : 'Mode pengembangan'}</b></div>
            <div><span>Shell offline</span><b>{pwa.controller ? 'Siap' : 'Belum siap'}</b></div>
            <div><span>Install ke layar utama</span><b>{pwa.installed ? 'Sudah terpasang' : pwa.canInstall ? 'Tersedia' : 'Lewat menu Chrome'}</b></div>
          </div>
          {pwa.canInstall && !pwa.installed && <button type="button" className="owner-primary" onClick={() => void installPwa()}><Smartphone size={14} /> Instal aplikasi</button>}
          <div className="owner-setting-note">
            <strong>Cara install di Chrome</strong>
            <span>{pwa.installed ? 'Aplikasi sudah terpasang dan berjalan sebagai PWA.' : 'Buka Chrome di tablet → menu ⋮ → pilih "Instal aplikasi" atau "Tambahkan ke layar utama". Jika opsi belum muncul, pastikan halaman dibuka lewat HTTPS, tunggu service worker aktif, lalu muat ulang. Tombol Instal aplikasi di atas muncul bila Chrome menawarkan pemasangan otomatis.'}</span>
          </div>
          <div className="owner-setting-note">
            <strong>PWA</strong>
            <span>{pwa.error || (pwa.active ? `Setelah kunjungan pertama, shell aplikasi bisa dibuka ulang tanpa jaringan. Data operasional ${online ? 'berada di Supabase dan butuh koneksi' : 'tetap tersimpan di perangkat ini'}.` : 'Aktif setelah build produksi dimuat ulang. Mode pengembangan tidak mendaftarkan service worker.')}</span>
          </div>
        </section>
      </div>

      <div className="owner-savebar">
        <span>{dirty ? 'Ada perubahan yang belum disimpan.' : 'Semua pengaturan tersimpan.'}</span>
        <button className="owner-primary" onClick={save} disabled={!dirty}><Save size={15} /> Simpan pengaturan</button>
      </div>
    </>
  )
}
