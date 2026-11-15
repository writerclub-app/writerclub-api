/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { sign } from 'hono/jwt'

type Bindings = { DB: D1Database; JWT_SECRET: string }

export const auth = new Hono<{ Bindings: Bindings }>()

// ── Helpers PBKDF2 (Web Crypto — sem dependências externas) ──────────────────

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  const hashArr = new Uint8Array(bits)
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('')
  const hashHex = [...hashArr].map(b => b.toString(16).padStart(2, '0')).join('')
  return `pbkdf2:${saltHex}:${hashHex}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false
  const salt = new Uint8Array(parts[1].match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const expectedHash = parts[2]
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  const hashArr = new Uint8Array(bits)
  const hashHex = [...hashArr].map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex === expectedHash
}

function makeJwt(authId: string, secret: string) {
  return sign(
    {
      sub: authId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 dias
    },
    secret,
    'HS256'
  )
}

// ── POST /auth/token — JWT para OAuth (Google / Microsoft) ───────────────────

auth.post('/token', async (c) => {
  const body = await c.req.json<{ authId: string }>()
  if (!body.authId) return c.json({ error: 'authId required' }, 400)
  const token = await makeJwt(body.authId, c.env.JWT_SECRET)
  return c.json({ token })
})

// ── POST /auth/register — cadastro com email + senha ─────────────────────────

auth.post('/register', async (c) => {
  const body = await c.req.json<{ email: string; password: string; username: string; displayName?: string }>()

  if (!body.email || !body.password || !body.username) {
    return c.json({ error: 'email, password e username são obrigatórios' }, 400)
  }
  if (body.password.length < 8) {
    return c.json({ error: 'Senha deve ter no mínimo 8 caracteres' }, 400)
  }

  const email = body.email.trim().toLowerCase()
  const username = body.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')

  // Verificar se email ou username já existem
  const existing = await c.env.DB.prepare(
    'SELECT id FROM profiles WHERE email = ? OR username = ? LIMIT 1'
  ).bind(email, username).first<{ id: string }>()

  if (existing) {
    return c.json({ error: 'Email ou username já cadastrado' }, 409)
  }

  const passwordHash = await hashPassword(body.password)

  const result = await c.env.DB.prepare(`
    INSERT INTO profiles (auth_id, email, username, display_name, password_hash)
    VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)
    RETURNING auth_id, username, display_name
  `).bind(email, username, body.displayName ?? username, passwordHash).first<{
    auth_id: string; username: string; display_name: string
  }>()

  if (!result) return c.json({ error: 'Erro ao criar conta' }, 500)

  const token = await makeJwt(result.auth_id, c.env.JWT_SECRET)
  return c.json({ token, authId: result.auth_id, username: result.username }, 201)
})

// ── POST /auth/login — login com email + senha ────────────────────────────────

auth.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>()

  if (!body.email || !body.password) {
    return c.json({ error: 'email e password são obrigatórios' }, 400)
  }

  const email = body.email.trim().toLowerCase()

  const profile = await c.env.DB.prepare(
    'SELECT auth_id, username, display_name, avatar_url, password_hash FROM profiles WHERE email = ? LIMIT 1'
  ).bind(email).first<{
    auth_id: string; username: string; display_name: string; avatar_url: string | null; password_hash: string | null
  }>()

  // Resposta genérica para não revelar se email existe
  if (!profile || !profile.password_hash) {
    return c.json({ error: 'Email ou senha incorretos' }, 401)
  }

  const valid = await verifyPassword(body.password, profile.password_hash)
  if (!valid) return c.json({ error: 'Email ou senha incorretos' }, 401)

  const token = await makeJwt(profile.auth_id, c.env.JWT_SECRET)
  return c.json({
    token,
    authId: profile.auth_id,
    username: profile.username,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
  })
})
