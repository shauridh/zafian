/**
 * Stable unique ID that does not depend on crypto.randomUUID.
 * Older Android WebViews (Chrome < 92) do not expose crypto.randomUUID,
 * which previously threw inside save handlers and silently aborted them.
 */
export function createId(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${Date.now().toString(36)}-${hex}`
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
