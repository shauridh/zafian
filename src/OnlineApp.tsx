import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { App } from './App'
import { createOnlineDriver, setOnlineDriver, setOnlineSignOutHandler } from './lib/online'
import { createOutlet, readOutletAccess, supabaseGateway } from './lib/repo/supabase-gateway'
import { initialOnlineStore, loadStore } from './lib/repo/snapshot'
import { PRIMARY_STORAGE_KEY, primeStorageCache } from './lib/storage'
import { readSupabaseConfig, supabaseClient, type SupabaseConfig } from './lib/supabase'

type Phase = 'memuat' | 'masuk' | 'siap' | 'gagal'

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

const translateAuthError = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return 'Email atau kata sandi salah.'
  if (/email not confirmed/i.test(message)) return 'Email belum dikonfirmasi. Cek kotak masuk lalu konfirmasi akun.'
  if (/rate limit|too many/i.test(message)) return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.'
  return message
}

type Props = { storageWarning?: string }

/**
 * Titik masuk aplikasi:
 * - tanpa VITE_SUPABASE_URL/ANON_KEY → mode lokal (pengembangan & check:ui)
 * - dengan env → wajib login, data dibaca/ditulis ke Supabase (sumber kebenaran)
 */
export function OnlineApp({ storageWarning }: Props) {
  const resolved = useMemo(() => {
    try {
      return { config: readSupabaseConfig(), error: '' }
    } catch (error) {
      return { config: null, error: describeError(error) }
    }
  }, [])

  if (resolved.error) {
    return (
      <div className="auth-screen">
        <div className="auth-card" role="alert">
          <span className="eyebrow">KONFIGURASI SUPABASE</span>
          <h1>Konfigurasi belum lengkap</h1>
          <p className="auth-error">{resolved.error}</p>
          <p className="auth-hint">Isi environment variable di dashboard Vercel, lalu deploy ulang karena Vite menanamkan nilainya saat build.</p>
        </div>
      </div>
    )
  }

  if (!resolved.config) return <App storageWarning={storageWarning} />
  return <SupabaseApp config={resolved.config} storageWarning={storageWarning} />
}

function SupabaseApp({ config, storageWarning }: { config: SupabaseConfig; storageWarning?: string }) {
  const client = useMemo(() => supabaseClient(config), [config])
  const [phase, setPhase] = useState<Phase>('memuat')
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const boot = useCallback(async () => {
    setPhase('memuat')
    setError('')
    try {
      const { data, error: sessionError } = await client.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session) {
        setPhase('masuk')
        return
      }

      // Aplikasi personal single-outlet: akun pemilik yang belum punya outlet
      // langsung dibuatkan satu outlet otomatis, tanpa layar onboarding.
      // Outlet selalu berasal dari baris staf akun yang login (bukan env),
      // supaya penulisan tidak pernah memakai outlet yang bukan haknya.
      const access = await readOutletAccess(client)
      if (access && access.role !== 'owner') {
        throw new Error(`Akun ini terdaftar sebagai kasir untuk outlet ${access.outletId}, bukan owner. Ubah role menjadi owner di tabel staff agar bisa mengelola menu dan pengaturan.`)
      }
      const outletId = access ? access.outletId : await createOutlet(client, 'Outlet utama')

      const gateway = supabaseGateway(client)
      const snapshot = await loadStore(gateway, outletId)
      // Outlet baru mulai kosong; katalog contoh hanya untuk mode lokal.
      const store = initialOnlineStore(snapshot)
      setOnlineDriver(createOnlineDriver(gateway, outletId, snapshot))
      primeStorageCache(PRIMARY_STORAGE_KEY, store)
      setPhase('siap')
    } catch (caught) {
      setError(describeError(caught))
      setPhase('gagal')
    }
  }, [client, config])

  useEffect(() => { void boot() }, [boot])

  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setOnlineDriver(null)
        setPhase('masuk')
      }
    })
    return () => { data.subscription.unsubscribe() }
  }, [client])

  const submitSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setPhase('memuat')
    const { error: signInError } = await client.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) {
      setError(translateAuthError(signInError.message))
      setPhase('masuk')
      return
    }
    setPassword('')
    await boot()
  }

  const signOut = useCallback(async () => {
    await client.auth.signOut().catch(() => undefined)
    setOnlineDriver(null)
    setPhase('masuk')
  }, [client])

  useEffect(() => {
    setOnlineSignOutHandler(signOut)
    return () => { setOnlineSignOutHandler(null) }
  }, [signOut])

  if (phase === 'siap') return <App storageWarning={storageWarning} />

  if (phase === 'memuat') {
    return <div className="boot-screen">Menghubungkan ke Supabase…</div>
  }

  if (phase === 'masuk') {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={submitSignIn}>
          <span className="eyebrow">SABANA POS • ONLINE</span>
          <h1>Masuk pemilik</h1>
          <p className="auth-hint">Satu akun pemilik untuk satu outlet. Data kasir tersimpan di Supabase dan hanya bisa dibuka dengan akun ini.</p>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <label>Email
            <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="pemilik@contoh.com" />
          </label>
          <label>Kata sandi
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" />
          </label>
          <button className="auth-submit" type="submit">Masuk</button>
          <p className="auth-hint">Pertama kali? Buat satu user di dashboard Supabase → Authentication → Users, lalu masuk di sini. Outlet dibuat otomatis pada login pertama.</p>
        </form>
      </div>
    )
  }

  const aksesBermasalah = /owner|RLS|row-level security|akses ditolak/i.test(error)
  return (
    <div className="auth-screen">
      <div className="auth-card" role="alert">
        <span className="eyebrow">KONEKSI GAGAL</span>
        <h1>Data outlet belum bisa dimuat</h1>
        <p className="auth-error">{error}</p>
        <p className="auth-hint">{aksesBermasalah
          ? 'Buka Supabase → SQL Editor dan jalankan blok "Akses ditolak (RLS)" di supabase/README.md agar akun ini terdaftar sebagai owner outlet, lalu tekan Coba lagi.'
          : 'Periksa koneksi internet, URL/anon key Supabase, dan kebijakan RLS. Data lama di perangkat tidak dihapus.'}</p>
        <button className="auth-submit" type="button" onClick={() => void boot()}>Coba lagi</button>
        <button className="auth-secondary" type="button" onClick={() => void signOut()}>Keluar</button>
      </div>
    </div>
  )
}
