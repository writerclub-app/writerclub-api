# CLAUDE.md — writerclub-api

Guidelines for working on this codebase with Claude.

## Project overview

Cloudflare Worker REST API for WriterClub. Built with Hono v4 and Cloudflare D1 (SQLite). Deployed via Wrangler.

## Absolute rules

- **Never commit without explicit user approval.** Prepare files and suggest a commit message, then wait.
- **Never hardcode secrets.** `JWT_SECRET` and all credentials live in Cloudflare environment variables only.
- **Never disable CORS** or widen `origin` beyond the three allowed origins in `src/index.ts`.

## Architecture

```
src/index.ts         → app entry, CORS, route mounting
src/middleware/
  auth.ts            → authMiddleware (enforces JWT) + verifyToken (soft check)
src/routes/
  auth.ts            → POST /auth/token
  writings.ts        → CRUD for writings
  profiles.ts        → profile upsert, /me routes, public /:username
  follows.ts         → follow/unfollow + follower/following lists
  likes.ts           → like/unlike + count
src/db/
  schema.sql         → single source of truth for D1 schema
```

## Coding patterns

### Every route file starts with the reference path

```ts
/// <reference path="../../worker-configuration.d.ts" />
```

### Type bindings are always explicit

```ts
type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { authId: string }

export const myRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>()
```

### Auth: use `authMiddleware` for protected routes

```ts
import { authMiddleware } from '../middleware/auth'

route.post('/', authMiddleware, async (c) => {
  const authId = c.get('authId') // string, guaranteed by middleware
  // ...
})
```

For routes that optionally accept a token (e.g. `GET /profiles/:username`), use `verifyToken`:

```ts
import { verifyToken } from '../middleware/auth'

const authHeader = c.req.header('Authorization')
if (authHeader?.startsWith('Bearer ')) {
  const payload = await verifyToken(authHeader.slice(7), c.env.JWT_SECRET)
  // payload is { authId } or null
}
```

### Database: always use `.bind()` — never string interpolation

```ts
// ✅ correct
await c.env.DB.prepare('SELECT * FROM profiles WHERE auth_id = ?')
  .bind(authId)
  .first()

// ❌ never do this
await c.env.DB.prepare(`SELECT * FROM profiles WHERE auth_id = '${authId}'`)
```

### Pagination: consistent pattern across all list endpoints

```ts
const page   = Number(c.req.query('page') ?? 1)
const limit  = 20
const offset = (page - 1) * limit
// ...
return c.json({ data: results, page, limit })
```

### Error responses: always return JSON

```ts
return c.json({ error: 'Descriptive message' }, 404)
```

## Database schema

Schema lives in `src/db/schema.sql`. All tables use `TEXT` primary keys (random hex UUIDs via `lower(hex(randomblob(16)))`). Timestamps are `TEXT` in ISO 8601 format (`datetime('now')`).

To apply schema changes:

```bash
# Local (run from writerclub-api/)
wrangler d1 execute writerclub --local --file=src/db/schema.sql

# Remote (run from writerclub-api/)
wrangler d1 execute writerclub --file=src/db/schema.sql
```

**Never drop or rename columns** in production without a migration plan — D1 does not support ALTER TABLE DROP COLUMN.

## Adding a new route

1. Create `src/routes/<name>.ts` — start with the `/// <reference>` line and explicit `Bindings`/`Variables` types.
2. Import and mount it in `src/index.ts`: `app.route('/<name>', <name>)`.
3. Add any new tables or indexes to `src/db/schema.sql`.
4. Write tests in `test/`.

## Running locally

```bash
# Run from writerclub-api/
pnpm dev          # starts wrangler dev at localhost:8787
pnpm test         # runs vitest
```

## Deployment

```bash
# Run from writerclub-api/
pnpm deploy
```

## What not to do

- Do not use `any` types — keep all Hono generics explicit.
- Do not catch errors silently without a reason — either handle or re-throw.
- Do not add new CORS origins without discussing it first.
- Do not store user content (writings, bios) in anything other than D1.
- Do not add external npm dependencies without a clear reason — the Worker bundle size matters.
