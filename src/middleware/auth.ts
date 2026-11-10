/// <reference path="../../worker-configuration.d.ts" />
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'

type Variables = {
  authId: string
}

export const authMiddleware = createMiddleware<{
  Bindings: { DB: D1Database; JWT_SECRET: string }
  Variables: Variables
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.slice(7)
  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256")
    c.set('authId', payload.sub as string)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
})

/** Verifica um JWT e retorna o payload, ou null se inválido. */
export async function verifyToken(
  token: string,
  secret: string
): Promise<{ authId: string } | null> {
  try {
    const payload = await verify(token, secret, 'HS256')
    if (!payload.sub) return null
    return { authId: payload.sub as string }
  } catch {
    return null
  }
}
