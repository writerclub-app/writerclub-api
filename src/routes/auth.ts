/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { sign } from 'hono/jwt'

type Bindings = { DB: D1Database; JWT_SECRET: string }

export const auth = new Hono<{ Bindings: Bindings }>()

// POST /auth/token — gera JWT para o authId do usuário logado
auth.post('/token', async (c) => {
  const body = await c.req.json<{ authId: string }>()

  if (!body.authId) {
    return c.json({ error: 'authId required' }, 400)
  }

  const token = await sign(
    {
      sub: body.authId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 dias
    },
    c.env.JWT_SECRET,
    'HS256'
  )

  return c.json({ token })
})
