/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { authId: string }

export const likes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /likes/:writingId — contagem + se o usuário atual curtiu
likes.get('/:writingId', async (c) => {
  const { writingId } = c.req.param()
  const authId = c.req.header('Authorization')
    ? await getAuthIdFromHeader(c.req.header('Authorization')!, c.env.JWT_SECRET)
    : null

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM likes WHERE writing_id = ?`
  ).bind(writingId).first<{ count: number }>()

  const liked = authId
    ? !!(await c.env.DB.prepare(
        `SELECT 1 FROM likes WHERE auth_id = ? AND writing_id = ?`
      ).bind(authId, writingId).first())
    : false

  return c.json({ count: countRow?.count ?? 0, liked })
})

// POST /likes/:writingId — curtir
likes.post('/:writingId', authMiddleware, async (c) => {
  const authId = c.get('authId')
  const { writingId } = c.req.param()

  const writing = await c.env.DB.prepare(
    `SELECT id FROM writings WHERE id = ? AND is_public = 1`
  ).bind(writingId).first()
  if (!writing) return c.json({ error: 'Writing not found' }, 404)

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO likes (auth_id, writing_id) VALUES (?, ?)`
  ).bind(authId, writingId).run()

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM likes WHERE writing_id = ?`
  ).bind(writingId).first<{ count: number }>()

  return c.json({ ok: true, liked: true, count: countRow?.count ?? 0 })
})

// DELETE /likes/:writingId — descurtir
likes.delete('/:writingId', authMiddleware, async (c) => {
  const authId = c.get('authId')
  const { writingId } = c.req.param()

  await c.env.DB.prepare(
    `DELETE FROM likes WHERE auth_id = ? AND writing_id = ?`
  ).bind(authId, writingId).run()

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM likes WHERE writing_id = ?`
  ).bind(writingId).first<{ count: number }>()

  return c.json({ ok: true, liked: false, count: countRow?.count ?? 0 })
})

// Utilitário interno — decodifica JWT sem lançar erro
async function getAuthIdFromHeader(authHeader: string, secret: string): Promise<string | null> {
  try {
    const token = authHeader.replace('Bearer ', '')
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(atob(payloadB64)) as { sub?: string }
    return payload.sub ?? null
  } catch {
    return null
  }
}
