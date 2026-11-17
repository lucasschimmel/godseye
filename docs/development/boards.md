# Boards (Excalidraw)

Status: local software, 2026-11-17. Not deployed on the dedicated server.

Boards is a separate TanStack Start application, `apps/boards`, that embeds the upstream
`@excalidraw/excalidraw` component (MIT) and adds accounts, several boards per account and sharing.
Excalidraw is a dependency, not a fork: updating it is a version bump. A rewrite remains possible later
because the persistence contract (`apps/boards/src/lib/contracts.ts`) is independent of the editor.

## Run locally

```sh
bun run --filter @godseye/boards dev
```

Open `http://localhost:4500` (`BOARDS_PORT` changes it) and create an account. State lives under
`.local/boards` (PGlite database and a generated auth secret, never committed).

| Variable | Purpose |
| --- | --- |
| `BOARDS_DATABASE_URL` | External PostgreSQL. Without it, embedded PGlite under `BOARDS_STATE_DIR`. |
| `BOARDS_STATE_DIR` | Local state directory (default `.local/boards`). |
| `BOARDS_AUTH_SECRET` | Required in production. Outside production a private one is generated once. |
| `BOARDS_BASE_URL` | Public origin used by auth cookies and trusted origins. |
| `BOARDS_ALLOW_SIGNUP` | `false` disables self-registration (hosted instances). |

## Model

- Accounts use Better Auth email/password (12 characters minimum, HttpOnly cookies).
- A board has exactly one owner and any number of `editor` / `viewer` members (25 maximum).
- Owner: rename, delete, share, change roles. Editor: edit. Viewer: read only. A member may leave.
- A non-member always receives `NOT_FOUND`, so board existence is not disclosed. Sharing is by the
  e-mail address of an existing account; there is no invitation flow yet.
- A scene is saved with optimistic concurrency: the client sends the revision it loaded, and a stale
  save is refused with `CONFLICT` and never overwrites newer content. The editor then asks for a reload.
- Images are stored once per board by Excalidraw file id. Limits (`server/limits.ts`): 100 boards per
  owner, 5 MiB per scene, 10,000 elements, 100 images per board, 4 MiB per image.

## Verification

`tests/boards-service.test.ts` covers visibility, role enforcement, revision conflicts (including two
concurrent saves), image storage, owner protection and cascade deletion against an in-memory PGlite
database. The browser path (sign-up, board creation, drawing, autosave, reload) was exercised by hand
against the dev server on 2026-11-17. A scripted Playwright journey is not written yet.

## Known limits

- Single writer at a time: no real-time collaboration (it needs a WebSocket or CRDT channel that the
  platform does not offer yet; the platform application API is SSE only).
- Production Excalidraw fonts may be fetched from a public CDN unless `EXCALIDRAW_ASSET_PATH` is pointed at
  self-hosted assets. Verify this on the first production build before exposing the application.
- The application does not use `@godseye/app-backend`: its custom routes are fixed-path GET/POST with a
  16 KiB body, too small for scenes. It needs a database and a persistent volume, which the delivery
  runtime does not provide yet (gap inventory B3), so it cannot be deployed by the platform today.
- `apps/boards` is excluded from the root TypeScript project (two TanStack routers cannot share one
  `Register` declaration) and is checked by its own `tsc -p apps/boards/tsconfig.json` in `bun run typecheck`.
