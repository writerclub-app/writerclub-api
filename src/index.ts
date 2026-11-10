import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { writings } from './routes/writings'

type Bindings = {
  DB: D1Database
  JWT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: ['https://writerclub.app', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/', (c) => c.json({ ok: true, service: 'writerclub-api' }))

app.route('/writings', writings)

export default app
