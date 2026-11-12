# writerclub-api

REST API for [WriterClub](https://writerclub.app) — a Cloudflare Worker built with Hono and D1.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers |
| Framework | [Hono](https://hono.dev) v4 |
| Database | Cloudflare D1 (SQLite) |
| Auth | JWT (HS256) via `hono/jwt` |
| Tests | Vitest + `@cloudflare/vitest-plugin` |
| Deploy | Wrangler v4 |

## Prerequisites

- Node.js 18+
- pnpm
- Cloudflare account with Workers and D1 enabled
- Wrangler authenticated (`wrangler login`)

## Setup

```bash
# Run from writerclub-api/
pnpm install
```

## Local development

```bash
# Run from writerclub-api/
pnpm dev
```

Server runs at `http://localhost:8787`.

Apply the schema to the local D1 database on first run:

```bash
# Run from writerclub-api/
wrangler d1 execute writerclub --local --file=src/db/schema.sql
```

## Tests

```bash
# Run from writerclub-api/
pnpm test
```

## Deploy

```bash
# Run from writerclub-api/
pnpm deploy
```

Apply the schema to the remote D1 database before the first deploy:

```bash
# Run from writerclub-api/
wrangler d1 execute writerclub --file=src/db/schema.sql
```

## Environment variables

Set in the Cloudflare dashboard (Workers → Settings → Variables):

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret used to sign and verify JWTs |

The `DB` binding (D1) is declared in `wrangler.jsonc`.

## Endpoints

### Auth

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/auth/token` | ❌ | Generate a JWT for the given `authId` |

### Writings

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/writings` | ❌ | Public paginated feed (`?page=1`) |
| `GET` | `/writings/feed` | ✅ | Feed of writings from followed users |
| `GET` | `/writings/:slug` | ❌ | Single public writing |
| `POST` | `/writings` | ✅ | Publish a writing |
| `DELETE` | `/writings/:localId` | ✅ | Unpublish a writing |

### Profiles

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/profiles` | ✅ | Create or update profile (upsert) |
| `GET` | `/profiles/me` | ✅ | Authenticated user's profile |
| `PUT` | `/profiles/me` | ✅ | Update profile fields |
| `DELETE` | `/profiles/me` | ✅ | Delete account and all writings |
| `GET` | `/profiles/:username` | ❌ | Public profile + writings |

### Follows

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/follows/:username` | ✅ | Follow a user |
| `DELETE` | `/follows/:username` | ✅ | Unfollow a user |
| `GET` | `/follows/:username/followers` | ❌ | List followers |
| `GET` | `/follows/:username/following` | ❌ | List following |

### Likes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/likes/:writingId` | ❌ | Like count + whether the current user liked it |
| `POST` | `/likes/:writingId` | ✅ | Like a writing |
| `DELETE` | `/likes/:writingId` | ✅ | Unlike a writing |

> Routes marked ✅ require `Authorization: Bearer <token>`.

## Project structure

```
writerclub-api/
├── src/
│   ├── index.ts          # Entry point — Hono app + route registration
│   ├── middleware/
│   │   └── auth.ts       # authMiddleware (JWT) + verifyToken helper
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── writings.ts
│   │   ├── profiles.ts
│   │   ├── follows.ts
│   │   └── likes.ts
│   └── db/
│       └── schema.sql    # D1 schema (profiles, writings, follows, likes)
├── test/
├── wrangler.jsonc
├── tsconfig.json
└── vitest.config.mts
```

## Database (D1)

Tables: `profiles`, `writings`, `follows`, `likes`.  
Full schema in [`src/db/schema.sql`](src/db/schema.sql).

## CORS

Allowed origins: `https://writerclub.app`, `https://writerclub.pages.dev`, `http://localhost:5173`.
