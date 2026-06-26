# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project direction

The codebase began as a **demo graph viewer with placeholder data** (Alice/Bob/ACME), now being built into a transparency tool: scrape Israeli news (first source **ynet**) → extract people/orgs + their relationships → a searchable, source-backed graph.

**Read `plans/hon-shilton-poc.md`** — the POC architecture and 7-phase roadmap. **Phase 1 is built** (`hon-shilton-pipeline/` + a SQLite-backed backend): scrape a ynet article → extract via **headless Claude Code** (`claude -p --json-schema`; no API key — uses your CC login) → write SQLite → backend serves it. The scraper/extractor is a **separate local module** from the public display; the SQLite file is the hand-off (later synced to a cloud read API). **Phase 2 is built** too: `npm run ingest-feed` batch-ingests the ynet RSS feed with caching, rate-limiting, and per-item error isolation. **Phase 3 is built**: cross-article entity resolution (QID → canonical-name → unique-alias) merges aliases onto one node, symmetric edges are normalized so a relation reported in either direction corroborates one edge, and the frontend draws edge thickness proportional to corroboration count. **Phase 4 is built but gated by a feature flag** (`REVIEW_GATE`, **default off**): when **on**, freshly extracted edges stay `proposed`, the public graph serves **approved edges only**, and a minimal `Pages/Review.tsx` queue (paged, Approve/Reject) backed by `GET /review/queue` + `POST /review/:edgeId` is the publishing gate (the backend now writes edge status, not just reads); when **off** (default), the graph shows extracted edges directly (proposed + approved, never the auto-rejected ones) and the frontend hides the review link. The backend exposes the flag at `GET /config` so the frontend adapts. **Phase 5 is built**: `npm run verify` is a distinct, independently-runnable stage that makes a **second Claude call** per extracted edge checking whether its supporting quote actually backs the relation; each edge gets `verification = supported | unsupported`, and `unsupported` edges are **auto-rejected** so they never reach the review queue (minimal human-in-the-loop). **Phase 6 is built**: a search-first egocentric explorer. Two new read endpoints — `GET /search?q=` (name/alias match, visible-graph scope, ranked by degree; empty `q` browses the most-connected entities) and `GET /neighbors/:id?limit=N` (focal entity + its 1-hop neighbors, capped and ranked **corroboration → confidence → recency**, returning `{nodes, edges, focalId, shown, total}`) — back a rebuilt React/D3 UI that opens to a search landing, renders a focal entity with its direct neighbors, and **lazily expands any node on demand** (the per-expand cap + `total>shown` drives a "show more" affordance on the expander badge), never loading the whole graph at once. **Phase 7 is built** (the POC is now feature-complete): the public payload carries the credibility layer it had been dropping — entities expose `qid` + `aliases[]` and edges expose `category` — and the frontend renders it. Edges are colored by category (a shared `src/lib/graph.ts` maps the six categories → colors + DOM-safe ids) with per-category arrowheads and a transparent hit-line so thin edges are clickable; clicking one opens `components/graph/EdgeDetailsPanel.tsx` (category chip, the relation statement, one source card per `edge_sources` row: `[ynet]` chip → article link, published date, exact quote — multiple chips when an edge is corroborated). A `components/explorer/CategoryFilter.tsx` (bottom-left, replacing the old inline Legend) toggles edge visibility per category with live counts; `NodeDetailsPanel.tsx` shows alias chips + a linked Wikidata QID; `Pages/Review.tsx` was rebuilt fully RTL/Hebrew on the paper aesthetic; and `index.html` is now `lang="he" dir="rtl"`. `tests/phase7.spec.ts` covers it end-to-end and the old Phase-7 guard PROBE was flipped to a positive assertion.

## Repository layout

Four independent npm packages — there is **no root `package.json` / workspace runner**. Each is installed and run on its own:

- `hon-shilton-frontend/` — Vite + React 18 + TypeScript SPA that renders the graph (port 3000).
- `hon-shilton-backend/` — Fastify + TypeScript API serving the graph from a **SQLite** file (`node:sqlite`) on port 3001; mostly read-only, plus the optional Phase-4 review write (`POST /review/:edgeId`, gated by `REVIEW_GATE`).
- `hon-shilton-pipeline/` — local Node/TS CLI: scrape ynet → extract via headless Claude Code → write the SQLite graph DB. Runs on your machine (manual now, cron later); not deployed.
- `test/` — standalone Playwright E2E package. `tests/phase6.spec.ts` drives the egocentric explorer (landing → search → focal render → incremental expand → details panel); `tests/phase7.spec.ts` covers provenance (edge-click → source panel with article link + quote), category filtering, and the node panel's aliases/QID. The generated `example.spec.ts` (points at playwright.dev) is unused. Needs both dev servers running; `npx playwright install chromium` if the browser build is missing.

## Commands

Run from inside each package directory.

**Backend** (`hon-shilton-backend/`):
- `npm run dev` — start API with hot reload (`tsx watch`).
- `npm run build` / `npm start` — compile to `dist/` with `tsc` / run the compiled server.
- `npm test` — `node --test` over `test/**/*.test.ts` via the `tsx` loader.
- DB path: server reads SQLite from `process.argv[2]` → `GRAPH_DB_PATH` → `server/graph.db` (the file the pipeline writes). `/Nodes` + `/Edges` return `503` until the pipeline has created the tables.
- `REVIEW_GATE` env var (default **off**; accepts `1`/`true`/`on`/`yes`) toggles the Phase-4 review gate. Off: the graph serves extracted edges directly. On: approved-only + the review queue is the gate. Exposed at `GET /config`.

**Pipeline** (`hon-shilton-pipeline/`):
- `npm run ingest -- [URL] [--fixture] [--scrape-only] [--force] [--db PATH]` — scrape one ynet article → extract → write SQLite. DB defaults to `../hon-shilton-backend/server/graph.db`. `--fixture` skips the Claude call (synthetic data, plumbing only); `--scrape-only` stops after caching the article.
- `npm run ingest-feed -- [FEED_URL] [--limit N] [--delay-ms N] [--fixture] [--scrape-only] [--force] [--db PATH]` — batch-ingest the ynet RSS feed (default `StoryRss2.xml`): each item is fetched, premium/cached/failed items are recorded and skipped (a single failure never aborts the run), the rest are extracted. RSS `<tags>` are passed to extraction as entity hints. `--delay-ms` (default 2000) rate-limits between network fetches; `--limit` caps how many items are processed.
- `npm run verify -- [--force] [--limit N] [--fixture] [--db PATH]` — Phase-5 verification pass: for each edge, a second Claude call checks whether the supporting quote backs the relation, writing `verification = supported | unsupported`. Default processes only `unchecked` edges (idempotent/resumable); `--force` re-checks every edge; `--fixture` skips the Claude call (always `supported`, plumbing only). Unsupported edges are dropped from the served graph.
- `npm run dump -- [DB]` — print the current graph (display shape; excludes `unsupported` edges).
- `npm test` — `node --test` (tsx). Real extraction/verification needs the `claude` CLI logged in; tune via `GRAPH_EXTRACT_MODEL` (default `opus`) / `GRAPH_EXTRACT_TIMEOUT_MS` (default 360000) — shared by both Claude calls.

**Frontend** (`hon-shilton-frontend/`):
- `npm run dev` — Vite dev server on port 3000 (auto-opens browser).
- `npm run build` — `tsc && vite build`. `npm run preview` — serve the build.
- `npm run lint` — ESLint over `ts,tsx` with `--max-warnings 0`. Note: there is no `.eslintrc` in the repo, so this script needs a config added before it will run.
- No frontend unit-test runner is configured.

**Full stack:** no combined script. Run the pipeline once to populate the DB, then start the backend and frontend. **The frontend needs the backend running** — it fetches all data through the Vite proxy.

**Docker:** `docker-compose up` builds both images (frontend 3000, backend 3001). The Dockerfiles run the `dev` scripts. (Not updated for the pipeline / SQLite yet.)

## Architecture

### Pipeline — local scrape + extract (writes the DB)
`hon-shilton-pipeline/src/` owns the SQLite schema and all writes. Two CLIs share one core: `ingest.ts` (one URL) and `ingest-feed.ts` (the RSS feed, via `rss.ts`) both build dependency-injected `{ fetch, extract }` deps (`buildDeps`) and call `pipeline.ts` — `ingestOne` (cache check → `ynet.ts` fetch + JSON-LD parse + premium skip → cache → `extract.ts` Claude call → `storeExtraction`) and `feed.ts` `runFeed` (rate-limited loop, per-item error isolation, `summarize`). Stores via `db.ts` (`upsertEntity` resolves QID → canonical-name → unique-alias via `resolveEntity` and merges aliases, `findOrCreateEdge` keyed on src+tgt+relation with undirected edges normalized to (min,max), `addSource` for corroboration). The **verification stage** (`verify-edges.ts` CLI → `verification.ts` `runVerification` → `verify.ts` Claude call) mirrors the ingest shape: a DI'd `{ verify }` dep (`buildVerifyDeps`), per-edge error isolation, idempotent over `unchecked` edges; it reads via `db.ts` `getEdgesToVerify` and writes the verdict via `setVerification`, **auto-rejecting** unsupported edges via `setEdgeStatus` (so they never reach the queue and are dropped from the served graph by the backend's `visibleEdgeCondition`; the pipeline's `getGraph` is an unfiltered debug dump). The single headless-Claude spawn/parse lives in `claude.ts` (`runClaude`), shared by `extract.ts` and `verify.ts`. `taxonomy.ts` is the controlled relation vocabulary; `article-status.ts`/`verification-status.ts`/`edge-status.ts` are the `ArticleStatus`/`Verification`/`EdgeStatus` enums (values match the SQLite CHECK strings); `http.ts`/`paths.ts`/`cli-args.ts`/`sleep.ts`/`report.ts` are the shared helpers. Both Claude calls use your Claude Code login (no `ANTHROPIC_API_KEY`); **do not** use `--bare` (it bypasses that login).

### Backend — SQLite graph API + optional review gate
`server/index.ts` reads the DB path (CLI arg → `GRAPH_DB_PATH` → `server/graph.db`) and the `REVIEW_GATE` flag, then `initStore(dbPath, { reviewGate })`. `server/graphStore.ts` holds the queries (incl. `getReviewQueue`, `setEdgeStatus`, `isReviewGateEnabled`, the `ReviewAction` enum, and a `visibleEdgeCondition` helper that branches on the flag — `status='approved'` when on, `status!='rejected'` when off); `server/endpoints.ts` holds the handlers, imported with `.js` extensions even from `.ts` source — required by NodeNext ESM (`"type": "module"`).

- `GET /config` → `{ reviewGate }` — the feature flag, available even before the DB is populated
- `GET /Nodes` → entities in display shape (`id, name, type, group, qid, aliases[], …`; Phase 7 added `qid` + `aliases` for the node panel); only entities touched by a **visible** edge
- `GET /Edges` → display shape (`id, source, target, relation, category, directed, value` = corroboration count, plus `sources[]`); `category` (Phase 7) drives edge color + the filter. **visible edges only** (gate on → approved; gate off → non-rejected). `confidence/status/verification` gate the query but aren't returned
- `GET /search?q=&limit=` → entities (display shape + `degree`) whose `canonical_name` or any alias matches, restricted to the visible-graph scope and ranked by degree; **empty `q` browses** the most-connected entities (powers the landing suggestions)
- `GET /neighbors/:id?limit=` → `{ nodes, edges, focalId, shown, total }` — the focal entity + its 1-hop neighbors over **visible edges only**, capped at `limit` (default 8) and ranked **corroboration → confidence → recency**; `total > shown` is what the frontend turns into "show more". `400` on a non-integer id
- `GET /review/queue?limit=&offset=` → `{ items, total }` — paged `proposed` edges with entity names, relation, outlet, and quote (gate-independent)
- `POST /review/:edgeId` → `{ action: 'approve' | 'reject' }` updates `status`; `400` on a bad action, `404` on an unknown edge
- `GET /graph-addition.json` → reads `graph-addition.json` from disk (legacy node-expansion; later superseded by neighbor queries)

`/Nodes`, `/Edges`, `/search`, `/neighbors/:id`, and `/review/queue` return `503` until the SQLite graph tables exist; `/config` works regardless; the addition endpoint returns `404` when the file is absent. (`/Nodes` + `/Edges` are the legacy whole-graph dump, retained but no longer used by the egocentric frontend.)

### Frontend — data flow
- `services/api.ts` calls **relative** `/api/*` URLs. `vite.config.ts` proxies `/api/*` → `http://localhost:3001`, **stripping the `/api` prefix**, so `/api/Nodes` hits the backend's `/Nodes`.
- Two routes (`App.tsx`, full-bleed — no shared container wrapper): `/` → `Pages/NetworkGraph.tsx` (the egocentric explorer) and `/review` → `Pages/Review.tsx` (the Phase-4 review queue). The explorer fetches `GET /config` on mount and only shows the "Review queue" link when `reviewGate` is on.
- `Pages/NetworkGraph.tsx` is the explorer + state owner. With **no focal entity** it renders `components/explorer/Landing.tsx` (search-first hero + suggested entities). Selecting a result (`SearchAPI`/`NeighborAPI`) sets the focal node and shows the graph; it accumulates `{nodes, edges}` and a per-node `meta(shown,total)` map as the user expands. **Never bulk-fetches** `/Nodes`+`/Edges` — only `/search` + `/neighbors`. Expanding a node fetches its neighbors and merges (dedupe by node id / edge key); re-expanding the same node requests `shown + STEP` ("show more"). `expandable`/`remaining` are derived (memoized) from `meta` and drive the expander badges.
- `components/explorer/SearchBox.tsx` is the debounced autocomplete (keyboard-navigable, two variants: hero + bar); `Landing.tsx` composes it with the suggestion chips.
- `Pages/Review.tsx` is a decoupled table of `proposed` edges (`ReviewAPI.queue`/`decide`) with Approve/Reject buttons and Prev/Next paging; it does not touch the graph.
- `components/graph/D3NetworkGraph.tsx` renders imperatively — a D3 force simulation settled synchronously in an SVG ref inside `useEffect`, then zoom-to-fit (gradient nodes, directed arrowheads, corroboration-weighted links, focal amber ring, hover focus, drag, expander "+"/"+N" badges). It receives `nodes/edges/focalId/selectedId/expandable/remaining/handlers` as props and does **not** fetch; positions persist across re-renders via a `posRef`, and a `key={session}` remount on a fresh search re-centers cleanly.
- `components/graph/NodeDetailsPanel.tsx` is the RTL framer-motion slide-in for the selected node (type chip, description, an "expand this node" action).

### Data shape (the source of truth)
Live frontend types in `src/types/index.ts`:
- `Node { id: number; name: string; group: number; type: string; image?; description?; qid?; aliases? }`; `SearchResult extends Node { degree }`.
- `Edge { id?; source: number; target: number; relation: string; category?; value?; directed?; sources? }` (`id` is used as the merge-dedupe key during expansion — see `edgeKey` in `src/lib/graph.ts`, also the home of the category→color map); `NeighborGraph { nodes, edges, focalId, shown, total }`.

The backend's `/Nodes` + `/Edges` select **only the columns the frontend renders** (`id/name/type/description/image/qid` + derived `group` + `aliases[]` on nodes; `id/source/target/relation/category/directed/value` + `sources[]` on edges) — the store has more (`subtype`; `confidence/status/verification`) but those aren't fetched into the public payload. The `/review/queue` endpoint additionally returns `confidence/verification` because `Pages/Review.tsx` shows them. The authoritative store schema lives in `hon-shilton-pipeline/src/db.ts`.

## Gotchas / dead code — do not extend these

Two sets of legacy code shadow the real files. Nothing imports them; do not add to them or copy their types:

- `src/Entities/` — a **conflicting** schema (`node_id: string`, `type: 'person' | 'linkingEntity'`, `image_url`, …) and mock `NodeAPI`/`EdgeAPI` that return `[]`. Ignore it; use `src/types` + `src/services/api.ts`.
- `src/Components/` (capital **C**) — `NetwrokGraph.tsx` (sic) and `NodeDetailPanel.tsx`, stale duplicates of the real lowercase `src/components/graph/` files.

The active directories are lowercase `src/components/` and capital-P `src/Pages/` (`App.tsx` imports `./Pages/NetworkGraph`). Because `src/Components/` and `src/components/` differ only by case, they collide on case-insensitive filesystems (macOS/Windows) — consolidate rather than adding case-variant paths.
