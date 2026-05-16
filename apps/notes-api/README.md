# notes-api

Reference Ingenium application: a small but realistic notes service with
users, tags, and full-text search, backed by an embedded SQLite database.

This app is the answer to **"what does a real Ingenium app look like?"**
It's intentionally not a hello-world — it exercises the framework's
plugin system, decorators, validation surface, error boundary, and
real persistent state, while staying under ~700 lines and requiring
zero external services.

## What it demonstrates

- `app.register(plugin, opts)` — auth and structured-logging plugins
- `app.decorate` / `app.decorateRequest` — lazy `ctx.user`, eager `ctx.log`
- Module augmentation so decorated fields show up on `ctx` in TypeScript
- `Router()` per resource group, mounted under `/api`
- `ctx.body.json(zodSchema)` validation at the body-parse boundary
- Centralized `app.onError` mapping `IngeniumValidationError` → 422,
  `IngeniumUnauthorizedError` → 401, `IngeniumNotFoundError` → 404
- `app.hooks.onRequest` / `onResponse` for structured request logging
- Real persistent storage via `better-sqlite3` (WAL + foreign keys, FTS5
  for full-text search with a graceful LIKE fallback)
- Graceful SIGINT/SIGTERM shutdown

## Run it

```sh
npm install         # from the repo root
npm run dev -w ingenium-app-notes-api
```

The DB file is created on first boot at `./data/notes.db` (override with
`DATABASE_FILE=...`). No setup script needed.

```sh
npm test -w ingenium-app-notes-api          # vitest integration suite
npm run typecheck -w ingenium-app-notes-api # tsc --noEmit
```

## Endpoints

| Method | Path                  | Auth | Purpose                                     |
| ------ | --------------------- | ---- | ------------------------------------------- |
| GET    | `/api/health`         | no   | DB ping + uptime + version                  |
| POST   | `/api/users/signup`   | no   | Create user, returns `{ user, token }`      |
| POST   | `/api/users/tokens`   | no   | Issue a new token for an existing email     |
| GET    | `/api/users/me`       | yes  | Caller's profile                            |
| GET    | `/api/notes`          | yes  | List, with `?limit`, `?offset`, `?tag`, `?q`|
| POST   | `/api/notes`          | yes  | Create `{ title, body?, tags? }`            |
| GET    | `/api/notes/:id`      | yes  | Single note (404 if not yours)              |
| PATCH  | `/api/notes/:id`      | yes  | Partial update                              |
| DELETE | `/api/notes/:id`      | yes  | Remove (204)                                |

## Sample curl session

```sh
# Sign up and capture the token.
TOKEN=$(curl -s -X POST localhost:3000/api/users/signup \
  -H content-type:application/json \
  -d '{"email":"alice@example.com","display_name":"Alice"}' | jq -r .token)

# Create a tagged note.
curl -s -X POST localhost:3000/api/notes \
  -H "authorization: Bearer $TOKEN" \
  -H content-type:application/json \
  -d '{"title":"Buy milk","body":"2L whole","tags":["errand","grocery"]}'

# List, filter by tag, search.
curl -s localhost:3000/api/notes -H "authorization: Bearer $TOKEN"
curl -s 'localhost:3000/api/notes?tag=grocery' -H "authorization: Bearer $TOKEN"
curl -s 'localhost:3000/api/notes?q=milk' -H "authorization: Bearer $TOKEN"
```

## Configuration

| Env var         | Default            | Notes                                  |
| --------------- | ------------------ | -------------------------------------- |
| `PORT`          | `3000`             | Pass `0` to bind an ephemeral port     |
| `DATABASE_FILE` | `./data/notes.db`  | Use `:memory:` for ephemeral runs      |
| `LOG_LEVEL`     | `info`             | pino level (`silent` for tests)        |
| `NODE_ENV`      | `development`      | `development` / `production` / `test`  |
