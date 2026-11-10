/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { authId: string }

export const writings = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /writings — feed público paginado
writings.get('/', async (c) => {
  const page = Number(c.req.query('page') ?? 1)
  const limit = 20
  const offset = (page - 1) * limit

  const { results } = await c.env.DB.prepare(`
    SELECT w.id, w.title, w.slug, w.excerpt, w.category_name,
           w.published_at, w.author_id, p.username, p.display_name
    FROM writings w
    LEFT JOIN profiles p ON p.auth_id = w.author_id
    WHERE w.is_public = 1
    ORDER BY w.published_at DESC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all()

  return c.json({ data: results, page, limit })
})

// GET /writings/:slug — writing individual público
writings.get('/:slug', async (c) => {
  const slug = c.req.param('slug')

  const writing = await c.env.DB.prepare(`
    SELECT w.*, p.username, p.display_name
    FROM writings w
    LEFT JOIN profiles p ON p.auth_id = w.author_id
    WHERE w.slug = ? AND w.is_public = 1
  `).bind(slug).first()

  if (!writing) return c.json({ error: 'Not found' }, 404)
  return c.json({ data: writing })
})

// POST /writings — publicar writing (autenticado)
writings.post('/', authMiddleware, async (c) => {
  const authId = c.get('authId')
  const body = await c.req.json<{
    localId: string
    title: string
    slug: string
    content: string
    excerpt?: string
    categoryName?: string
  }>()

  const { localId, title, slug, content, excerpt, categoryName } = body

  if (!localId || !title || !slug || !content) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  await c.env.DB.prepare(`
    INSERT INTO writings (author_id, local_id, title, slug, content, excerpt, category_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(author_id, local_id) DO UPDATE SET
      title = excluded.title,
      slug = excluded.slug,
      content = excluded.content,
      excerpt = excluded.excerpt,
      category_name = excluded.category_name,
      updated_at = datetime('now')
  `).bind(authId, localId, title, slug, content, excerpt ?? null, categoryName ?? null).run()

  return c.json({ ok: true })
})

// DELETE /writings/:localId — despublicar (autenticado)
writings.delete('/:localId', authMiddleware, async (c) => {
  const authId = c.get('authId')
  const localId = c.req.param('localId')

  await c.env.DB.prepare(`
    DELETE FROM writings WHERE author_id = ? AND local_id = ?
  `).bind(authId, localId).run()

  return c.json({ ok: true })
})
