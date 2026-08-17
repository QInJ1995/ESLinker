import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs'

const ALGORITHM = 'aes-256-gcm'

function getSecret(): string {
  const dir = app.getPath('userData')
  const file = join(dir, 'eslinker.secret')
  if (existsSync(file)) {
    return readFileSync(file, 'utf8').trim()
  }
  const secret = randomBytes(32).toString('hex')
  writeFileSync(file, secret, { mode: 0o600 })
  chmodSync(file, 0o600)
  return secret
}

function deriveKey(): Buffer {
  const secret = getSecret()
  const pepper = 'eslinker-local-pepper-2024'
  return createHash('sha256').update(secret).update(pepper).digest()
}

export function encrypt(plain: string): string {
  if (!plain) return ''
  const key = deriveKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decrypt(token: string): string {
  if (!token) return ''
  const parts = token.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') return ''
  const key = deriveKey()
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const data = Buffer.from(parts[3], 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function maskPassword(): string {
  return encrypt('')
}
