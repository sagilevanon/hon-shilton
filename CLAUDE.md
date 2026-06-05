# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project direction

The codebase began as a **demo graph viewer with placeholder data** (Alice/Bob/ACME), now being built into a transparency tool: scrape Israeli news (first source **ynet**) → extract people/orgs + their relationships → a searchable, source-backed graph.

**Read `plans/hon-shilton-poc.md`** — the POC architecture and 7-phase roadmap. **Phase 1 is built** (`hon-shilton-pipeline/` + a SQLite-backed backend): scrape a ynet article → extract via **headless Claude Code** (`claude -p --json-schema`; no API key — uses your CC login) → write SQLite → backend serves it. The scraper/extractor is a **separate local module** from the public display; the SQLite file is the hand-off (later synced to a cloud read API). Pending in later phases: feed-scale ingestion, cross-article entity resolution, the human-review queue, the verification pass, and the egocentric `search`/`neighbors` UX.

## Repository layout

Four independent npm packages — there is **no root `package.json` / workspace runner**. Each is installed and run on its own:

- `hon-shilton-frontend/` — Vite + React 18 + TypeScript SPA that renders the graph (port 3000).
- `hon-shilton-backend/` — Express + TypeScript **read-only** API serving the graph from a **SQLite** file (`node:sqlite`) on port 3001.
- `hon-shilton-pipeline/` — local Node/TS CLI: scrape ynet → extract via headless Claude Code → write the SQLite graph DB. Runs on your machine (manual now, cron later); not deployed.
- `test/` — standalone Playwright E2E package. Currently only the generated `example.spec.ts` (points at playwright.dev); not yet wired to the app.

## Commands

Run from inside each package directory.

**Backend** (`hon-shilton-backend/`):
- `npm run dev` — start API with hot reload (`tsx watch`).
- `npm run build` / `npm start` — compile to `dist/` with `tsc` / run the compiled server.
- `npm test` — `node --test` over `test/**/*.test.ts` via the `tsx` loader.
- DB path: server reads SQLite from `process.argv[2]` → `GRAPH_DB_PATH` → `server/graph.db` (the file the pipeline writes). `/Nodes` + `/Edges` return `503` until the pipeline has created the tables.

**Pipeline** (`hon-shilton-pipeline/`):
- `npm run ingest -- [URL] [--fixture] [--scrape-only] [--force] [--db PATH]` — scrape one ynet article → extract → write SQLite. DB defaults to `../hon-shilton-backend/server/graph.db`. `--fixture` skips the Claude call (synthetic data, plumbing only); `--scrape-only` stops after caching the article.
- `npm run dump -- [DB]` — print the current graph (display shape).
- `npm test` — `node --test` (tsx). Real extraction needs the `claude` CLI logged in; tune via `GRAPH_EXTRACT_MODEL` (default `opus`) / `GRAPH_EXTRACT_TIMEOUT_MS` (default 360000).

**Frontend** (`hon-shilton-frontend/`):
- `npm run dev` — Vite dev server on port 3000 (auto-opens browser).
- `npm run build` — `tsc && vite build`. `npm run preview` — serve the build.
- `npm run lint` — ESLint over `ts,tsx` with `--max-warnings 0`. Note: there is no `.eslintrc` in the repo, so this script needs a config added before it will run.
- No frontend unit-test runner is configured.

**Full stack:** no combined script. Run the pipeline once to populate the DB, then start the backend and frontend. **The frontend needs the backend running** — it fetches all data through the Vite proxy.

**Docker:** `docker-compose up` builds both images (frontend 3000, backend 3001). The Dockerfiles run the `dev` scripts. (Not updated for the pipeline / SQLite yet.)

## Architecture

### Pipeline — local scrape + extract (writes the DB)
`hon-shilton-pipeline/src/` owns the SQLite schema and all writes. `ingest.ts` (CLI) → `ynet.ts` (fetch page, pull the article out of JSON-LD `articleBody`, skip premium) → `extract.ts` (spawns `claude -p --output-format json --json-schema … --append-system-prompt …`; parses the envelope's `structured_output`) → `db.ts` (`upsertEntity` QID-first then name, `findOrCreateEdge` keyed on src+tgt+relation, `addSource` for corroboration). `taxonomy.ts` is the controlled relation vocabulary. Extraction uses your Claude Code login (no `ANTHROPIC_API_KEY`); **do not** use `--bare` (it bypasses that login).

### Backend — read-only SQLite graph API
`server/index.ts` opens the SQLite DB (CLI arg → `GRAPH_DB_PATH` → `server/graph.db`) and serves it read-only. `server/graphStore.ts` holds the queries; `server/endpoints.ts` holds the handlers, imported with `.js` extensions even from `.ts` source — required by NodeNext ESM (`"type": "module"`).

- `GET /Nodes` → entities in display shape (`id, name, type, group, …`)
- `GET /Edges` → relationships in display shape (`source, target, relation, value` = corroboration count, plus `category/confidence/status/sources[]`)
- `GET /graph-addition.json` → reads `graph-addition.json` from disk (legacy node-expansion; later superseded by neighbor queries)

`/Nodes` + `/Edges` return `503` until the SQLite graph tables exist; the addition endpoint returns `404` when the file is absent.

### Frontend — data flow
- `services/api.ts` calls **relative** `/api/*` URLs. `vite.config.ts` proxies `/api/*` → `http://localhost:3001`, **stripping the `/api` prefix**, so `/api/Nodes` hits the backend's `/Nodes`.
- `Pages/NetworkGraph.tsx` is the single page and state owner: on mount it fetches nodes + edges (`NodeAPI`, `EdgeAPI`), computes header stats, owns selection/hover/expansion state.
- `components/graph/D3NetworkGraph.tsx` renders imperatively — a D3 force simulation in an SVG ref inside `useEffect` (zoom/pan, drag, hover highlighting). It receives nodes/edges/handlers as props; it does not fetch.
- `components/graph/NodeDetailsPanel.tsx` shows the selected node (framer-motion).
- **Node expansion:** hardcoded `nodeId: 10` renders a "+"; clicking fetches `graph-addition.json` and merges. (To be generalized into real neighbor queries in a later phase.)

### Data shape (the source of truth)
Live frontend types in `src/types/index.ts`:
- `Node { id: number; name: string; group: number; type: string; image? }` (`image` falls back to `public/silhouette.svg`).
- `Edge { source: number; target: number; relation: string; value? }`.

The backend serves this shape from SQLite and includes extra fields the FE currently ignores (`qid/subtype/description` on nodes; `category/confidence/status/sources[]` on edges). The authoritative store schema lives in `hon-shilton-pipeline/src/db.ts`.

## Gotchas / dead code — do not extend these

Two sets of legacy code shadow the real files. Nothing imports them; do not add to them or copy their types:

- `src/Entities/` — a **conflicting** schema (`node_id: string`, `type: 'person' | 'linkingEntity'`, `image_url`, …) and mock `NodeAPI`/`EdgeAPI` that return `[]`. Ignore it; use `src/types` + `src/services/api.ts`.
- `src/Components/` (capital **C**) — `NetwrokGraph.tsx` (sic) and `NodeDetailPanel.tsx`, stale duplicates of the real lowercase `src/components/graph/` files.

The active directories are lowercase `src/components/` and capital-P `src/Pages/` (`App.tsx` imports `./Pages/NetworkGraph`). Because `src/Components/` and `src/components/` differ only by case, they collide on case-insensitive filesystems (macOS/Windows) — consolidate rather than adding case-variant paths.
