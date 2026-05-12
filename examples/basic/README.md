# riftexpress-example-basic

A minimal RiftExpress hello-world server showing middleware, route params, JSON body parsing, and the error boundary. Run from this directory with `npm run dev` (uses `tsx`, so any Node 20+ works). The server listens on port 3000 and exposes:

- `GET /` — returns the string `Hello from RiftExpress` (text/plain)
- `GET /users/:id` — returns `{ "id": "<param>" }` as JSON
- `POST /echo` — parses the JSON body and echoes it back as `{ "youSent": ... }`

A logger middleware times every request and prints `METHOD PATH -> Nms`. The `app.onError` handler catches anything thrown inside a handler and replies with a JSON error.
