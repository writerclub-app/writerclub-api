/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { authId: string }

export const follows = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// POST /follows/:username — seguir usuário
follows.post('/:username', authMiddleware, async (c) => {
  const followerAuthId = c.get('authId')
  const { username } = c.req.param()

  const target = await c.env.DB.prepare(
    `SELECT auth_id FROM profiles WHERE username = ?`
  ).bind(username).first<{ auth_id: string }>()

  if (!target) return c.json({ error: 'User not found' }, 404)
  if (target.auth_id === followerAuthId) return c.json({ error: 'Cannot follow yourself' }, 400)

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)`
  ).bind(followerAuthId, target.auth_id).run()

  return c.json({ ok: true, following: true })
})

// DELETE /follows/:username — deixar de seguir
follows.delete('/:username', authMiddleware, async (c) => {
  const followerAuthId = c.get('authId')
  const { username } = c.req.param()

  const target = await c.env.DB.prepare(
    `SELECT auth_id FROM profiles WHERE username = ?`
  ).bind(username).first<{ auth_id: string }>()

  if (!target) return c.json({ error: 'User not found' }, 404)

  await c.env.DB.prepare(
    `DELETE FROM follows WHERE follower_id = ? AND following_id = ?`
  ).bind(followerAuthId, target.auth_id).run()

  return c.json({ ok: true, following: false })
})

// GET /follows/:username/followers — lista de seguidores do usuário
follows.get('/:username/followers', async (c) => {
  const { username } = c.req.param()
  const page  = Number(c.req.query('page') ?? 1)
  const limit = 20
  const offset = (page - 1) * limit

  const target = await c.env.DB.prepare(
    `SELECT auth_id FROM profiles WHERE username = ?`
  ).bind(username).first<{ auth_id: string }>()

  if (!target) return c.json({ error: 'User not found' }, 404)

  const result = await c.env.DB.prepare(`
    SELECT p.username, p.display_name, p.avatar_url
    FROM follows f
    JOIN profiles p ON p.auth_id = f.follower_id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(target.auth_id, limit, offset).all()

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM follows WHERE following_id = ?`
  ).bind(target.auth_id).first<{ count: number }>()

  return c.json({ followers: result.results, total: total?.count ?? 0, page, limit })
})

// GET /follows/:username/following — lista de quem o usuário segue
follows.get('/:username/following', async (c) => {
  const { username } = c.req.param()
  const page  = Number(c.req.query('page') ?? 1)
  const limit = 20
  const offset = (page - 1) * limit

  const target = await c.env.DB.prepare(
    `SELECT auth_id FROM profiles WHERE username = ?`
  ).bind(username).first<{ auth_id: string }>()

  if (!target) return c.json({ error: 'User not found' }, 404)

  const result = await c.env.DB.prepare(`
    SELECT p.username, p.display_name, p.avatar_url
    FROM follows f
    JOIN profiles p ON p.auth_id = f.following_id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(target.auth_id, limit, offset).all()

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM follows WHERE follower_id = ?`
  ).bind(target.auth_id).first<{ count: number }>()

  return c.json({ following: result.results, total: total?.count ?? 0, page, limit })
})
