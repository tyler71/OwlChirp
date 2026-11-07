# OwlChirp frontend

Astro + React islands sharing state through [nanostores](https://github.com/nanostores/nanostores).
The build is static and gets embedded in the Go backend (`just build` from `new/`).

- `src/pages/index.astro` opens the CCP popup
- `src/pages/ccp.astro` is the CCP page
- `src/lib/stores.ts` holds shared state (`@nanostores/persistent` for notification throttling and UI prefs)
- `src/lib/realtime.ts` holds the WebSocket client for `/api/ws`

During development `pnpm dev` proxies `/api` (including WebSockets) to the backend on `:4444`
(override with `BACKEND_URL`).
