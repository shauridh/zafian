import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { OnlineApp } from './OnlineApp'
import './lib/native-printer-shim'
import { registerPwa } from './lib/pwa'
import { initStorage } from './lib/storage'
import './styles.css'

const container = document.getElementById('root')!
const root = createRoot(container)

root.render(<div className="boot-screen">Memuat data outlet…</div>)

// Registrasi PWA berjalan di belakang layar; boot data tidak menunggu service worker.
registerPwa()

void initStorage()
  .then((storage) => {
    root.render(
      <StrictMode>
        <OnlineApp storageWarning={storage.warning} />
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    console.error('Aplikasi gagal menyiapkan penyimpanan', error)
    const message = error instanceof Error ? error.message : String(error)
    root.render(
      <div className="boot-screen boot-error" role="alert">
        <strong>Aplikasi tidak bisa memuat penyimpanan.</strong>
        <p>{message}</p>
        <button onClick={() => window.location.reload()}>Muat ulang</button>
      </div>,
    )
  })
