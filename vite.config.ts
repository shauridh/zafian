import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vercel hanya menyajikan SPA statis; Worker Cloudflare tidak ikut dideploy.
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const onVercel = nodeEnv.VERCEL === '1'
const allowedHosts = (nodeEnv.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(onVercel ? [] : [cloudflare()])],
  // Tanpa plugin Cloudflare, Vite default menulis ke dist/. Samakan dengan
  // outputDirectory Vercel dan generator service worker.
  ...(onVercel ? { build: { outDir: 'dist/client', emptyOutDir: true } } : {}),
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
  },
})
