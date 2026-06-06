# wayfinder-map-keppelvn

Wayfinder map engine for Keppel VN (Saigon Centre). Project map and decisions
live in [`overview.md`](overview.md); per-capability records in
[`capabilities/`](capabilities/); cross-cutting gotchas in [`CLAUDE.md`](CLAUDE.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev harness (`owner=human`): static server on :5080, live-reload, and `rollup -c -w` rebuilding `dist/`. Leave this running. |
| `npm run dev:ensure` | Make sure a dev server is up **without disturbing one that already is** — reuses a running server, or starts a detached `owner=agent` one. Use this from scripts / Claude Code / QA. |
| `npm run dev:stop` | Stop an **agent-owned** dev server. Refuses to stop your `owner=human` server unless `--force`. |
| `npm run dev:status` | Print what the harness thinks is running and who owns it. |
| `npm run build` | One-shot Rollup build → `dist/` (ESM + UMD + min), then stage the deploy gallery into `dist/<BUILD_SECRET>/`. |
| `npm run deploy` | Build, then sync the gallery + bundle + data to DigitalOcean Spaces (needs `.env`). |
| `npm test` | Vitest suite (node env). |
| `npm run lint` | ESLint over `src/`. |

## The dev harness won't kill your `npm run dev`

`npm run dev` starts a small zero-dependency server (`.dev/server.mjs`) tagged
`owner=human`. It serves the repo on :5080, injects a live-reload client into
HTML responses (edits to `dist/`, `demo/`, or `datas/` reload the page; `src/`
edits rebuild `dist/` via the spawned `rollup -c -w`, which then reloads), and is
**the thing you leave running**.

Anything automated — Claude Code, tests, QA — must use **`npm run dev:ensure`**,
never `npm run dev`:

- If your human server is already up, `dev:ensure` is a **no-op** (it reuses it).
- If nothing is up, `dev:ensure` starts a **detached `owner=agent`** server.
- `npm run dev:stop` only stops an `owner=agent` server; it **refuses to stop
  your human server** without `--force`.
- If you later run `npm run dev` while an agent server holds :5080, the human
  server **reclaims** the port (so you get live-reload back).

The harness identifies its own servers via a health endpoint
(`/__dev/health`, sentinel `keppelvn-dev`), so it never mistakes a foreign
process for a dev server — and if :5080 is held by something that isn't ours, it
fails fast rather than killing it.

## Port convention

The dev server runs on **port 5080** by default, overridable via `PORT` (or
`.dev/config.json`):

```sh
npm run dev            # serves on http://localhost:5080
PORT=5081 npm run dev  # serves on http://localhost:5081
```

Override the port when 5080 is already taken so the second instance binds a free
port instead of failing.

## `npm test` and `npm run dev` coexist

The test suite **binds no port** — `fetch` is mocked and fixtures are read from
disk — so it never collides with a running dev server on 5080.

The one place the two could clash is `dist/`: a live `npm run dev` owns it
(`rollup -w` writes it, the harness serves it). To avoid a collision, the
build-verification test (`test/build/buildInfra.test.js`) builds into an
**isolated temp dir** rather than the shared `dist/`, via the
`WAYFINDER_BUILD_OUT_DIR` env var that `rollup.config.js` honors (default
`dist`). So `npm test` — and every `tars:run` iteration that invokes it — can run
at the same time as `npm run dev` without wiping or racing the watcher's `dist/`.

## Deploy

`npm run deploy` builds and uploads to DigitalOcean Spaces (S3-compatible) via
the `aws` CLI. Copy `.env.example` to `.env` and fill in `BUILD_SECRET` and the
`DO_SPACES_*` credentials first. The deployed product is the demo gallery
(`dist/<BUILD_SECRET>/`), the minified bundle, and the `datas/` + `qa-shims/`
assets the gallery references.
