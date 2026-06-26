# Hon Shilton (הון־שלטון)

> A transparency tool that turns Israeli news into a searchable, source-backed graph of **who is connected to whom** — and exactly which article said so.

**Hon Shilton** (Hebrew: *הון־שלטון*, "capital–government") is the nexus of money and political power. This project scans Israeli news, extracts **people and organizations** and the **relationships** between them — ownership, donations, family ties, business, politics, legal entanglements — and presents them as an interactive network graph where **every edge is backed by a real quote from a real article**.

The goal is civic: make the wealth–power network legible, with provenance you can click through to verify, in service of democracy and transparency.

> **Status:** Proof of concept — feature-complete across all 7 planned phases, not yet publicly deployed. One news source so far (**ynet**). See [`plans/hon-shilton-poc.md`](plans/hon-shilton-poc.md) for the full architecture and roadmap.

---

## How it works

```
  ┌─────────────────────────────────────────────────┐
  │  LOCAL PIPELINE  (hon-shilton-pipeline/)          │
  │                                                   │
  │   scrape ynet ──▶ extract (headless Claude Code)  │
  │        │              │                           │
  │        │         entity resolution                │
  │        │         (one real person = one node)     │
  │        ▼              ▼                            │
  │   article cache    SQLite graph DB                │
  │                       │                           │
  │   verify ──▶ does the quote actually back         │
  │              the relation? (2nd Claude call)      │
  └───────────────────────┬───────────────────────────┘
                           │  graph.db  (the hand-off)
                           ▼
  ┌─────────────────────────────────────────────────┐
  │  DISPLAY  (read-only)                             │
  │                                                   │
  │   backend  ──▶  egocentric query API (Express)    │
  │   frontend ──▶  search → focal node → expand      │
  │                 outward, click an edge for source │
  └─────────────────────────────────────────────────┘
```

The two halves are deliberately separate. The **pipeline** runs locally on your machine and is the only thing that writes data. The **display** (frontend + backend) is read-only and serves a copy of the SQLite file. The `.db` file is the hand-off between them (cloud sync is future work).

A few design choices worth calling out:

- **Source-backed by construction.** Every relationship carries the outlet, article URL, publication date, and the exact supporting quote. Corroboration across multiple articles is tracked and shown as edge thickness.
- **Hallucination guard.** A distinct verification pass makes a second model call per edge asking *"does this quote actually support this relation?"* Unsupported edges are auto-rejected before a human ever sees them.
- **Human-in-the-loop (optional).** A review-gate feature flag can hold every extracted edge as `proposed` until a person approves it in a review queue.
- **Egocentric exploration.** The graph is never dumped wholesale. You search for an entity, see its direct neighbors, and lazily expand outward node by node.
- **Hebrew / RTL first.** Content is Hebrew, the UI is right-to-left, and relationships are grouped into categories (family / finance / professional / political / legal / other).

---

## Repository layout

This is **not** a monorepo with a workspace runner — there is no root `package.json`. Each package is installed and run on its own.

| Package | Stack | Role |
| --- | --- | --- |
| [`hon-shilton-pipeline/`](hon-shilton-pipeline/) | Node + TypeScript (zero runtime deps) | Local CLI: scrape ynet → extract via headless Claude Code → write the SQLite graph DB. Runs on your machine; not deployed. |
| [`hon-shilton-backend/`](hon-shilton-backend/) | Express + TypeScript + `node:sqlite` | Read-only graph API on port **3001** (plus the optional review-write). |
| [`hon-shilton-frontend/`](hon-shilton-frontend/) | Vite + React 18 + TypeScript + D3 | The egocentric graph explorer on port **3000**. |
| [`test/`](test/) | Playwright | Standalone end-to-end tests driving the explorer and provenance UI. |

---

## Prerequisites

- **Node.js ≥ 22.5.0** — the backend and pipeline use the built-in `node:sqlite` module and `node --test`.
- **The `claude` CLI, installed and logged in.** Extraction and verification call **headless Claude Code** (`claude -p --json-schema …`), which uses your Claude Code subscription login. **No `ANTHROPIC_API_KEY` is needed**, and you should *not* use `--bare` (it bypasses that login). See [Claude Code](https://claude.com/claude-code).
  - You can exercise all the plumbing **without** the `claude` CLI by passing `--fixture` to the pipeline commands (synthetic data, no model calls).

---

## Quick start

The data flows one direction, so set it up in that order: **populate the DB → run the API → run the UI.**

```bash
# 1. Populate the SQLite graph from one ynet article.
#    (Drop --fixture once your `claude` CLI is logged in for real extraction.)
cd hon-shilton-pipeline
npm install
npm run ingest -- https://www.ynet.co.il/news/article/<id> --fixture

# 2. Serve the graph.  (new terminal)
cd hon-shilton-backend
npm install
npm run dev            # API on http://localhost:3001

# 3. Run the explorer.  (new terminal)
cd hon-shilton-frontend
npm install
npm run dev            # UI on http://localhost:3000
```

The frontend talks to the backend through the Vite dev proxy (`/api/*` → `http://localhost:3001`, with `/api` stripped), so **both servers must be running.** Open <http://localhost:3000> and search for an entity.

> If you skipped step 1, the graph endpoints return `503` until the SQLite tables exist.

---

## The pipeline

Run these from inside `hon-shilton-pipeline/`. The DB defaults to `../hon-shilton-backend/server/graph.db` (the exact file the backend reads); override with `--db PATH`.

```bash
# Ingest a single article: scrape → extract → write SQLite
npm run ingest -- [URL] [--fixture] [--scrape-only] [--force] [--db PATH]

# Batch-ingest the ynet RSS feed (rate-limited, cached, per-item error isolation)
npm run ingest-feed -- [FEED_URL] [--limit N] [--delay-ms N] [--fixture] [--force] [--db PATH]

# Verification pass: a 2nd Claude call per edge checks the quote backs the relation;
# unsupported edges are auto-rejected. Idempotent — only re-checks `unchecked` edges.
npm run verify -- [--force] [--limit N] [--fixture] [--db PATH]

# Print the current graph (debug dump)
npm run dump -- [DB]
```

Useful flags: `--fixture` skips the Claude call (synthetic data, plumbing only); `--scrape-only` stops after caching the article; `--force` re-processes already-seen items. Tune the model with `GRAPH_EXTRACT_MODEL` (default `opus`) and `GRAPH_EXTRACT_TIMEOUT_MS` (default `360000`).

A typical real run is: `ingest-feed` to extract a batch, then `verify` to drop unsupported edges, then start the servers.

---

## Backend API

Read-only graph queries (the egocentric explorer uses `search` + `neighbors`; the rest support review and legacy callers):

| Endpoint | Returns |
| --- | --- |
| `GET /config` | `{ reviewGate }` — the review-gate feature flag (works even before the DB exists). |
| `GET /search?q=&limit=` | Entities whose name or any alias matches, ranked by degree. Empty `q` browses the most-connected entities. |
| `GET /neighbors/:id?limit=` | `{ nodes, edges, focalId, shown, total }` — a focal entity + its 1-hop neighbors, capped and ranked (corroboration → confidence → recency). |
| `GET /Nodes`, `GET /Edges` | Legacy whole-graph dump in display shape (retained, no longer used by the UI). |
| `GET /review/queue?limit=&offset=` | `{ items, total }` — paged `proposed` edges for the review queue. |
| `POST /review/:edgeId` | `{ action: 'approve' \| 'reject' }` — updates an edge's status. |

Graph endpoints return `503` until the pipeline has created the SQLite tables.

### Commands & configuration

From `hon-shilton-backend/`:

```bash
npm run dev      # start with hot reload (tsx watch)
npm run build    # compile to dist/ with tsc
npm start        # run the compiled server
npm test         # node --test over test/**/*.test.ts
```

- **DB path** is resolved as: CLI arg → `GRAPH_DB_PATH` env → `server/graph.db`.
- **`REVIEW_GATE`** (default **off**; accepts `1`/`true`/`on`/`yes`) toggles the human-review gate.
  - **Off (default):** the graph serves extracted edges directly (never the auto-rejected ones).
  - **On:** freshly extracted edges stay `proposed`, the public graph serves **approved edges only**, and the review queue at `/review` is the publishing gate.
  - The flag is exposed at `GET /config` so the frontend adapts (it only shows the review link when the gate is on).

---

## Frontend

From `hon-shilton-frontend/`:

```bash
npm run dev       # Vite dev server on port 3000 (auto-opens)
npm run build     # tsc && vite build
npm run preview   # serve the production build
```

Two routes: `/` is the egocentric explorer (search landing → focal entity → lazy expand → edge/node detail panels), and `/review` is the Phase-4 review queue (shown only when `REVIEW_GATE` is on). The graph is rendered with a D3 force simulation; edges are colored by category and clickable to reveal their sources.

---

## Testing

End-to-end tests live in the standalone [`test/`](test/) package and need **both dev servers running** plus a populated DB.

```bash
cd test
npm install
npx playwright install chromium   # if the browser build is missing
npx playwright test
```

Each runtime package also has its own unit tests (`npm test`) via `node --test`.

---

## Data model

The authoritative schema lives in [`hon-shilton-pipeline/src/db.ts`](hon-shilton-pipeline/src/db.ts) (SQLite, accumulating across runs):

- **`entities`** — one row per real person/organization, deduped by Wikidata QID → canonical Hebrew name → unique alias.
- **`aliases`** — alternate names (e.g. an English name from a QID).
- **`edges`** — a relationship between two entities: relation, category, direction, confidence, review `status`, and `verification` verdict. Symmetric relations (spouse, sibling, business partner) are stored once and rendered undirected.
- **`edge_sources`** — one row per supporting article (URL, outlet, date, exact quote). **Multiple rows = corroboration.**
- **`articles`** — the fetch cache, so an article is never scraped twice.

---

## Roadmap

The POC is built in 7 phases, all complete:

1. **Tracer bullet** — one ynet article → Claude extraction → SQLite → API → graph.
2. **Feed ingest** — batch-ingest the ynet RSS feed with caching, rate-limiting, and per-item error isolation.
3. **Entity resolution** — cross-article dedup (one real person = one node) + symmetric-edge normalization + corroboration counts.
4. **Review gate** — optional human approve/reject queue before edges go public (feature-flagged).
5. **Verification** — a second model call per edge that auto-rejects unsupported relations.
6. **Egocentric explorer** — search-first UI that expands the graph node by node.
7. **Provenance & credibility** — clickable source cards (outlet, link, date, quote), category coloring/filtering, aliases + Wikidata QIDs.

Out of scope for the POC (future work): cron / continuous polling, sources beyond ynet, Postgres/Neo4j, Wikidata enrichment, embedding-based resolution, and public deployment.

---

## Contributing

This is an early-stage civic-tech proof of concept. Contributions, issues, and ideas are welcome. A couple of house rules worth knowing before you dig in:

- **Read [`CLAUDE.md`](CLAUDE.md)** — it documents the architecture, commands, data shapes, and the dead-code traps to avoid.
- Coding standards: small files, no inline comments, dependency injection, DRY; the pipeline stays zero-dependency; Zod (if used) only at the frontend↔backend boundary.
- There is legacy dead code under `src/Entities/` and `src/Components/` (capital **C**) — **do not extend it**; the live code is in lowercase `src/components/` and capital-P `src/Pages/`.

---

## License

Released under the **MIT License**. (A `LICENSE` file should accompany this README — add one if it is missing from your checkout.)
