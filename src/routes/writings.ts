import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  JWT_SECRET: string
}

export const writings = new Hono<{ Bindings: Bindings }>()

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

// GET /writings/:slug — writing individual
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
