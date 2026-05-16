# Example: plugin system

A minimal Ingenium server that demonstrates the plugin API.

What it shows:

- Defining a plugin with the `IngeniumPlugin<Opts>` type signature
- Registering it via `app.register(plugin, opts)`
- Adding an `onRequest` lifecycle hook for token validation
- Lazy `app.decorate('user', ...)` — factory runs the first time `ctx.user` is read
- Lazy `app.decorate('requireAuth', ...)` — returning a function for guard usage
- Eager `app.decorateRequest('requestId', ...)` — runs at the start of every request
- The `declare module 'ingenium'` augmentation pattern so decorated props show up in TypeScript intellisense

## Run

```sh
npm install
npm run dev
```

Then:

```sh
curl http://localhost:3000/                                       # 200, no auth needed
curl http://localhost:3000/me                                     # 401, missing token
curl -H "Authorization: Bearer demo" http://localhost:3000/me     # 200, authed
```

See [`docs/plugins.md`](../../docs/plugins.md) for the full plugin reference.
