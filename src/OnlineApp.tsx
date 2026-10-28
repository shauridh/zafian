import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { App } from './App'
import { createOnlineDriver, setOnlineDriver, setOnlineSignOutHandler } from './lib/online'
import { createOutlet, resolveOutletId, supabaseGateway } from './lib/repo/supabase-gateway'
import { assignGeneratedIds, loadStore } from './lib/repo/snapshot'
import { normalizeStore } from './lib/schema'
import { PRIMARY_STORAGE_KEY, primeStorageCache } from './lib/storage'
import { readSupabaseConfig, supabaseClient, type SupabaseConfig } from './lib/supabase'

type Phase = 'memuat' | 'masuk' | 'onboarding' | 'siap' | 'gagal'

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
  const [outletName, setOutletName] = useState('Outlet utama')

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

      let outletId: string
      try {
        outletId = await resolveOutletId(client, config)
      } catch (caught) {
        if (describeError(caught).includes('OUTLET_NOT_FOUND')) {
          setPhase('onboarding')
          return
        }
        throw caught
      }

      const gateway = supabaseGateway(client)
      const snapshot = await loadStore(gateway, outletId)
      // Outlet baru: seed katalog contoh sekali dengan ID uuid, lalu disimpan ke Supabase.
      const store = snapshot ?? assignGeneratedIds(normalizeStore({}))
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

  const submitOnboarding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setPhase('memuat')
    try {
      await createOutlet(client, outletName.trim() || 'Outlet utama')
      await boot()
    } catch (caught) {
      setError(describeError(caught))
      setPhase('onboarding')
    }
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
          <p className="auth-hint">Data outlet tersimpan di Supabase. Gunakan email dan kata sandi akun pemilik.</p>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <label>Email
            <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="pemilik@contoh.com" />
          </label>
          <label>Kata sandi
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" />
          </label>
          <button className="auth-submit" type="submit">Masuk</button>
          <p className="auth-hint">Belum punya akun? Buat lewat dashboard Supabase → Authentication → Users, lalu masuk di sini.</p>
        </form>
      </div>
    )
  }

  if (phase === 'onboarding') {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={submitOnboarding}>
          <span className="eyebrow">AKUN BELUM TERHUBUNG</span>
          <h1>Buat outlet pertama</h1>
          <p className="auth-hint">Akun ini belum punya outlet. Beri nama outlet; katalog contoh akan diisi otomatis dan bisa diubah dari mode pemilik.</p>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <label>Nama outlet
            <input required value={outletName} onChange={(event) => setOutletName(event.target.value)} placeholder="Outlet utama" />
          </label>
          <button className="auth-submit" type="submit">Buat outlet & mulai</button>
          <button className="auth-secondary" type="button" onClick={() => void signOut()}>Ganti akun</button>
        </form>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" role="alert">
        <span className="eyebrow">KONEKSI GAGAL</span>
        <h1>Data outlet belum bisa dimuat</h1>
        <p className="auth-error">{error}</p>
        <p className="auth-hint">Periksa koneksi internet, URL/anon key Supabase, dan kebijakan RLS. Data lama di perangkat tidak dihapus.</p>
        <button className="auth-submit" type="button" onClick={() => void boot()}>Coba lagi</button>
        <button className="auth-secondary" type="button" onClick={() => void signOut()}>Keluar</button>
      </div>
    </div>
  )
}
