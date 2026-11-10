/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { authId: string }

export const profiles = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /profiles/:username — perfil público
profiles.get('/:username', async (c) => {
  const { username } = c.req.param()

  const profile = await c.env.DB.prepare(
    `SELECT id, auth_id, username, display_name, bio, avatar_url, created_at
     FROM profiles WHERE username = ?`
  ).bind(username).first<{
    id: string; auth_id: string; username: string; display_name: string | null
    bio: string | null; avatar_url: string | null; created_at: string
  }>()

  if (!profile) return c.json({ error: 'Profile not found' }, 404)

  const page = Number(c.req.query('page') ?? 1)
  const limit = 20
  const offset = (page - 1) * limit

  const writings = await c.env.DB.prepare(
    `SELECT id, local_id, title, slug, excerpt, category_name, published_at
     FROM writings
     WHERE author_id = ? AND is_public = 1
     ORDER BY published_at DESC
     LIMIT ? OFFSET ?`
  ).bind(profile.auth_id, limit, offset).all()

  return c.json({
    profile: {
      username: profile.username,
      displayName: profile.display_name,
      bio: profile.bio,
      avatarUrl: profile.avatar_url,
      createdAt: profile.created_at,
    },
    writings: writings.results,
    page,
    limit,
  })
})

// POST /profiles — upsert de perfil (autenticado)
profiles.post('/', authMiddleware, async (c) => {
  const authId = c.get('authId')
  const body = await c.req.json<{
    username: string
    displayName?: string
    bio?: string
    avatarUrl?: string
  }>()

  if (!body.username) return c.json({ error: 'username required' }, 400)

  // Verifica se username já pertence a outro usuário
  const existing = await c.env.DB.prepare(
    `SELECT auth_id FROM profiles WHERE username = ?`
  ).bind(body.username).first<{ auth_id: string }>()

  if (existing && existing.auth_id !== authId) {
    return c.json({ error: 'username already taken' }, 409)
  }

  await c.env.DB.prepare(
    `INSERT INTO profiles (auth_id, username, display_name, bio, avatar_url)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(auth_id) DO UPDATE SET
       username     = excluded.username,
       display_name = excluded.display_name,
       bio          = excluded.bio,
       avatar_url   = excluded.avatar_url,
       updated_at   = datetime('now')`
  ).bind(
    authId,
    body.username,
    body.displayName ?? null,
    body.bio ?? null,
    body.avatarUrl ?? null,
  ).run()

  const profile = await c.env.DB.prepare(
    `SELECT id, auth_id, username, display_name, bio, avatar_url, created_at, updated_at
     FROM profiles WHERE auth_id = ?`
  ).bind(authId).first()

  return c.json({ profile })
})

// GET /profiles/me — perfil do usuário autenticado
profiles.get('/me', authMiddleware, async (c) => {
  const authId = c.get('authId')

  const profile = await c.env.DB.prepare(
    `SELECT id, auth_id, username, display_name, bio, avatar_url, created_at, updated_at
     FROM profiles WHERE auth_id = ?`
  ).bind(authId).first()

  if (!profile) return c.json({ error: 'Profile not found' }, 404)
  return c.json({ profile })
})

// PUT /profiles/me — atualizar campos do perfil (autenticado)
profiles.put('/me', authMiddleware, async (c) => {
  const authId = c.get('authId')
  const body = await c.req.json<{
    username?: string
    displayName?: string
    bio?: string
    avatarUrl?: string
  }>()

  // Verifica conflito de username se ele estiver sendo alterado
  if (body.username) {
    const existing = await c.env.DB.prepare(
      `SELECT auth_id FROM profiles WHERE username = ?`
    ).bind(body.username).first<{ auth_id: string }>()

    if (existing && existing.auth_id !== authId) {
      return c.json({ error: 'username already taken' }, 409)
    }
  }

  await c.env.DB.prepare(`
    UPDATE profiles SET
      username     = COALESCE(?, username),
      display_name = COALESCE(?, display_name),
      bio          = COALESCE(?, bio),
      avatar_url   = COALESCE(?, avatar_url),
      updated_at   = datetime('now')
    WHERE auth_id = ?
  `).bind(
    body.username   ?? null,
    body.displayName ?? null,
    body.bio        ?? null,
    body.avatarUrl  ?? null,
    authId,
  ).run()

  const profile = await c.env.DB.prepare(
    `SELECT id, auth_id, username, display_name, bio, avatar_url, created_at, updated_at
     FROM profiles WHERE auth_id = ?`
  ).bind(authId).first()

  if (!profile) return c.json({ error: 'Profile not found' }, 404)
  return c.json({ profile })
})

// DELETE /profiles/me — deletar conta e todos os writings (autenticado)
profiles.delete('/me', authMiddleware, async (c) => {
  const authId = c.get('authId')

  // Remove writings primeiro (FK referencia auth_id de profiles)
  await c.env.DB.prepare(
    `DELETE FROM writings WHERE author_id = ?`
  ).bind(authId).run()

  await c.env.DB.prepare(
    `DELETE FROM profiles WHERE auth_id = ?`
  ).bind(authId).run()

  return c.json({ ok: true })
})
