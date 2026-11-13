/// <reference path="../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { likes } from './routes/likes'
import { writings } from './routes/writings'
import { auth } from './routes/auth'
import { profiles } from './routes/profiles'
import { follows } from './routes/follows'
import { ai } from './routes/ai'

type Bindings = { DB: D1Database; AI: Ai; JWT_SECRET: string }

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: ['https://writerclub.app', 'https://writerclub.pages.dev', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/', (c) => c.json({ ok: true, service: 'writerclub-api' }))

app.route('/writings', writings)
app.route('/auth', auth)
app.route('/profiles', profiles)
app.route('/follows', follows)
app.route('/likes', likes)
app.route('/ai', ai)

export default app
