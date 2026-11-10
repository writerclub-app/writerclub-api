/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { authMiddleware, verifyToken } from '../middleware/auth'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { authId: string }

export const profiles = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /profiles/me — perfil do usuário autenticado (MUST be before /:username)
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
    body.username    ?? null,
    body.displayName ?? null,
    body.bio         ?? null,
    body.avatarUrl   ?? null,
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

  await c.env.DB.prepare(
    `DELETE FROM writings WHERE author_id = ?`
  ).bind(authId).run()

  await c.env.DB.prepare(
    `DELETE FROM profiles WHERE auth_id = ?`
  ).bind(authId).run()

  return c.json({ ok: true })
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
       username     = COALESCE(profiles.username, excluded.username),
       display_name = COALESCE(excluded.display_name, profiles.display_name),
       avatar_url   = COALESCE(excluded.avatar_url, profiles.avatar_url),
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

// GET /profiles/:username — perfil público (MUST be after /me)
// Accepts optional Authorization header to resolve isFollowing
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

  // Contagens de follows
  const [followersRow, followingRow, writingsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM follows WHERE following_id = ?`
    ).bind(profile.auth_id).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM follows WHERE follower_id = ?`
    ).bind(profile.auth_id).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT id, local_id, title, slug, excerpt, category_name, published_at
       FROM writings
       WHERE author_id = ? AND is_public = 1
       ORDER BY published_at DESC
       LIMIT ? OFFSET ?`
    ).bind(profile.auth_id, limit, offset).all(),
  ])

  // isFollowing: resolve se houver token válido no header
  let isFollowing = false
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = await verifyToken(authHeader.slice(7), c.env.JWT_SECRET)
      if (payload?.authId && payload.authId !== profile.auth_id) {
        const row = await c.env.DB.prepare(
          `SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?`
        ).bind(payload.authId, profile.auth_id).first()
        isFollowing = row !== null
      }
    } catch { /* token inválido — ignora */ }
  }

  return c.json({
    profile: {
      username: profile.username,
      displayName: profile.display_name,
      bio: profile.bio,
      avatarUrl: profile.avatar_url,
      createdAt: profile.created_at,
      followerCount: followersRow?.count ?? 0,
      followingCount: followingRow?.count ?? 0,
      isFollowing,
    },
    writings: writingsResult.results,
    page,
    limit,
  })
})
