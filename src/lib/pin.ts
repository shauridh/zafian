import type { OwnerPinRecord } from '../domain/settings'

/**
 * PIN owner disimpan sebagai SHA-256(salt:PIN). Kode pemulihan memakai salt
 * terpisah sehingga hash PIN tidak bisa dipakai untuk menebak kode pemulihan.
 */

const PIN_LENGTH_MIN = 4
const PIN_LENGTH_MAX = 8
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const RECOVERY_LENGTH = 12

export type NewOwnerPin = {
  record: OwnerPinRecord
  recoveryCode: string
}

function cryptoRef(): Crypto {
  const value = globalThis.crypto
  if (!value || !value.subtle) {
    throw new Error('Browser ini tidak mendukung SHA-256. Gunakan HTTPS atau browser modern untuk mengatur PIN.')
  }
  return value
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  cryptoRef().getRandomValues(bytes)
  return bytes
}

function randomHex(length: number): string {
  return [...randomBytes(length)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_LENGTH)
  return [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join('')
}

async function sha256(value: string): Promise<string> {
  const digest = await cryptoRef().subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export function normalizePin(value: string): string {
  return value.replace(/\D/g, '').slice(0, PIN_LENGTH_MAX)
}

export function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, RECOVERY_LENGTH)
}

export function formatRecoveryCode(value: string): string {
  const normalized = normalizeRecoveryCode(value)
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized
}

export function validatePin(pin: string): string | null {
  const normalized = normalizePin(pin)
  if (normalized.length < PIN_LENGTH_MIN) return `PIN minimal ${PIN_LENGTH_MIN} digit.`
  if (normalized.length > PIN_LENGTH_MAX) return `PIN maksimal ${PIN_LENGTH_MAX} digit.`
  if (!/^\d+$/.test(normalized)) return 'PIN hanya boleh berisi angka.'
  return null
}

export async function hashSecret(secret: string, salt: string): Promise<string> {
  return sha256(`${salt}:${secret}`)
}

export async function createOwnerPin(pin: string): Promise<NewOwnerPin> {
  const error = validatePin(pin)
  if (error) throw new Error(error)
  const normalizedPin = normalizePin(pin)
  const salt = randomHex(16)
  const recoverySalt = randomHex(16)
  const recoveryCode = randomRecoveryCode()
  const [hash, recoveryHash] = await Promise.all([
    hashSecret(normalizedPin, salt),
    hashSecret(recoveryCode, recoverySalt),
  ])
  return {
    record: {
      salt,
      hash,
      recoverySalt,
      recoveryHash,
      updatedAt: new Date().toISOString(),
    },
    recoveryCode: formatRecoveryCode(recoveryCode),
  }
}

export async function verifyOwnerPin(record: OwnerPinRecord | undefined, pin: string): Promise<boolean> {
  if (!record) return false
  const error = validatePin(pin)
  if (error) return false
  const hash = await hashSecret(normalizePin(pin), record.salt)
  return constantTimeEqual(hash, record.hash)
}

export async function verifyRecoveryCode(record: OwnerPinRecord | undefined, code: string): Promise<boolean> {
  if (!record) return false
  const normalized = normalizeRecoveryCode(code)
  if (normalized.length !== RECOVERY_LENGTH) return false
  const hash = await hashSecret(normalized, record.recoverySalt)
  return constantTimeEqual(hash, record.recoveryHash)
}
