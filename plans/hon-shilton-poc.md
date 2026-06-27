# Plan: Hon Shilton — Israeli-News Transparency Knowledge Graph (POC)

> Source PRD: architecture resolved in the 2026-05-31 design session (grilled decision tree). This plan is the POC slice: prove that real ynet articles can become a reviewed, sourced, searchable relationship graph — with a schema that survives into production.

## Mission

Scan Israeli news, extract **entities** (people, organizations) and their **relationships** (owns / donated-to / family / business / political / legal), and present them in a searchable, source-backed graph — to promote democracy and transparency. The POC de-risks the two genuinely unproven pieces: **Hebrew relation extraction** and **entity resolution**, end-to-end, on real ynet data.

## User stories

- **US-1 (Operator)** — I can run a pipeline that ingests ynet articles and extracts sourced entities + relationships into a store.
- **US-2 (Reader)** — I can search for an entity and see it together with its directly-connected entities and how they relate.
- **US-3 (Reader)** — I can explore the network outward node-by-node, without ever rendering the whole graph at once.
- **US-4 (Reader)** — I can click a relationship to see the source outlet, the article link, and the exact supporting quote.
- **US-5 (Reviewer)** — I can review extracted relationships in a queue and approve/reject each before it becomes public.
- **US-6 (System)** — One real person = exactly one node (deduped), with multi-source corroboration visible on each relationship.
- **US-7 (System)** — Unsupported / hallucinated relationships are caught automatically before they reach a human reviewer.
- **US-8 (Reader)** — I can read Hebrew content RTL and filter/understand relationships by category.
- **US-9 (Reader)** — I can pick two entities and see how they are related through indirect, multi-hop relationship chains — each link still source-backed — without leaving the explorer.

---

## Architectural decisions

Durable decisions that apply across all phases.

### Approach & scope
- **POC-first.** Manual/batch pipeline runs (no cron yet). One source: **ynet**. Binary directed edges between real entities — egocentric exploration (search → 1-hop neighbors → lazy-expand), never a full-graph dump.
- **Two modules.** A *local* scrape+extract pipeline (`hon-shilton-pipeline/`) writes a SQLite file; the *cloud* display (frontend + read-only backend) serves a synced copy. The SQLite file is the hand-off; cloud-sync is deferred.
- **No public/private-figure filter** — the mission is exposing corruption; the human reviewer judges per edge.
- **Out of scope for the POC:** cron/continuous polling, sources beyond ynet, Postgres/Neo4j, calling the Wikidata API for enrichment (we only *capture* QIDs), embedding-based resolution, and public deployment.

### Data model (SQLite, accumulating across runs)
- `entities(id PK, qid UNIQUE NULLABLE, canonical_name /* Hebrew */, type 'person'|'organization', subtype NULLABLE /* company|ngo|political_party|government_body|media_outlet */, description NULLABLE, image NULLABLE, created_at)`
- `aliases(id PK, entity_id FK, alias, UNIQUE(entity_id, alias))` — English name kept here when a QID provides it.
- `edges(id PK, src_entity_id FK, tgt_entity_id FK, relation, category 'משפחה'|'כספים'|'מקצועי'|'פוליטי'|'משפטי'|'אחר', raw_phrase NULLABLE /* preserved for 'other' */, directed BOOL, confidence 'low'|'med'|'high', status 'proposed'|'approved'|'rejected', verification 'unchecked'|'supported'|'unsupported', created_at)`
- `edge_sources(id PK, edge_id FK, url, outlet, published_date, quote, UNIQUE(edge_id, url))` — corroboration = multiple rows per edge.
- `articles(url PK, title, published_date, author NULLABLE, raw_body, fetched_at, status 'ok'|'premium_skipped'|'error')` — fetch cache; never re-fetch.
- **Relation taxonomy** = controlled vocabulary grouped by the five categories + `other` (raw phrase preserved). **Directionality** by relation semantics; symmetric relations (`spouse_of`, `sibling_of`, `business_partner`) stored once and rendered undirected.

### Query API (replaces today's static `/Nodes` + `/Edges` dump)
- `GET /api/search?q=` → entities matching `canonical_name` or any alias (approved-graph scope).
- `GET /api/entity/:id` → entity details (+ aliases, degree).
- `GET /api/neighbors/:id?depth=1&limit=N` → `{ nodes, edges }`, **approved only**, capped + ranked (by corroboration, then confidence, then recency).
- `GET /api/review/queue?status=proposed&limit=&offset=` → proposed edges with their entities + sources.
- `POST /api/review/:edgeId` → `{ action: 'approve' | 'reject' }`.
- All under the existing Vite `/api/*` proxy (which strips `/api`). Legacy `/Nodes` `/Edges` may stay during transition, then retire.

### Data flow
`local pipeline CLI (scrape → extract via headless Claude Code → resolve → store as 'proposed')` → `verification pass marks supported/unsupported` → `human review queue approves/rejects` → `cloud read API serves approved` → `frontend egocentric graph`.

### Stack & conventions
- **Pipeline = separate package** `hon-shilton-pipeline/` (Node/TS, ESM/NodeNext — `.js` import specifiers from `.ts` source), run via `tsx`. Extraction calls **headless Claude Code** — `claude -p --output-format json --json-schema <schema> --append-system-prompt <instructions> --model opus` — and reads the envelope's `structured_output`. Uses your Claude Code login (no API key); **not** `--bare` (it drops that login). Model via `GRAPH_EXTRACT_MODEL` (default Opus).
- **Store = `node:sqlite`** (built-in; no native build), wrapped in `db.ts` so it can swap to `better-sqlite3` / a cloud libSQL later. Pipeline owns/writes the schema; the backend opens the file read-only.
- Frontend reuses `src/components/graph/D3NetworkGraph.tsx` + `NodeDetailsPanel.tsx` and the capital-P `src/Pages/`. **Ignore** legacy dead code in `src/Entities/` and `src/Components/` (capital C).
- Frontend types evolve: `Node { id, qid?, name, type, subtype?, aliases?, description?, image? }`, `Edge { id, source, target, relation, category, confidence, directed, sources: [{url, outlet, publishedDate, quote}], status }`.
- **Prerequisite:** the `claude` CLI installed and logged in (Claude Code subscription auth — no `ANTHROPIC_API_KEY` needed).

---

## Phase 1: Tracer bullet — one article → graph

> **Status: DONE** (branch `phase-1-tracer-bullet`). Real Opus extraction on a live ynet article produced 8 sourced entities + 8 relations into SQLite; backend serves them in the FE shape. Pipeline + backend typecheck and tests pass.

**User stories**: US-1 (thin), US-2 (thin)

### What to build
The thinnest end-to-end path through every layer. A backend CLI takes **one hardcoded ynet article URL**, fetches the page, parses the JSON-LD `articleBody`, makes a **single-pass** Claude call that returns entities + relations (canonical Hebrew name, optional QID, relation + category, confidence, supporting quote), and writes them into a **new SQLite database using the full schema** (even though only some columns are exercised). A new approved-graph endpoint reads from SQLite, and the existing D3 graph renders the result. For this phase, extracted edges are treated as visible directly (the review gate arrives in Phase 4).

### Acceptance criteria
- [ ] `ANTHROPIC_API_KEY` documented; SQLite DB file created with all five tables on first run.
- [ ] Running the CLI on one real ynet article populates `entities`, `edges`, `edge_sources`, and caches the `articles` row.
- [ ] Each extracted edge has a category, a confidence, and at least one `edge_sources` row with a non-empty quote + the article URL.
- [ ] A backend endpoint returns the graph from SQLite, and the existing frontend renders the real Hebrew entities/relations from that article.
- [ ] Re-running on the same URL uses the `articles` cache and does not re-fetch the page.

---

## Phase 2: Feed-scale ingestion + caching

> **Status: DONE** (branch `phase-1-tracer-bullet`). `ingest-feed.ts` batch-ingests the ynet RSS feed (`rss.ts` parses 30 live items, splitting `<tags>` as entity hints). A shared dependency-injected core (`pipeline.ts` `ingestOne` + `feed.ts` `runFeed`) drives both CLIs; premium/cached/failed items are recorded and skipped, a per-item extraction failure no longer aborts the run, and `--delay-ms` rate-limits between fetches. Live smoke test confirmed fetch → cache → cache-skip on re-run; tsc + 11 `node --test` cases pass.

**User stories**: US-1

### What to build
Generalize ingestion from one hardcoded URL to the **ynet RSS feed** (`https://www.ynet.co.il/Integration/StoryRss2.xml`): parse the feed, follow each item link, fetch the article page, parse the JSON-LD `articleBody`, and **skip premium/paywalled** articles gracefully (recording them in `articles` as `premium_skipped`). Pass the RSS `<tags>` to extraction as entity hints. Batch-process all feed items through the existing single-pass extractor with **respectful rate-limiting** and the article cache so nothing is fetched twice.

### Acceptance criteria
- [ ] One CLI run ingests the current feed's non-premium articles and writes their entities/relations to SQLite.
- [ ] Premium/paywalled articles are detected, skipped, and recorded — they do not crash the run.
- [ ] Already-cached articles are not re-fetched on a second run; only new feed items are processed.
- [ ] Rate-limiting is applied between article fetches.
- [ ] The graph visibly accumulates more entities/relations than after Phase 1.

---

## Phase 3: Entity resolution & corroboration

> **Status: DONE** (branch `phase-1-tracer-bullet`). Resolution is QID-first, canonical-name-second, **alias-third** (`resolveEntity` in `db.ts`, alias match used only when it maps to a single entity), with aliases merged onto the matched node. `findOrCreateEdge` normalizes **undirected/symmetric** edges to `(min, max)` so the same pair reported in either direction collapses onto one row; corroboration = distinct `edge_sources`. The frontend renders edge stroke-width proportional to corroboration (`corroborationWidth(value)`). Verified end-to-end: two articles naming the same figure (QID + alias) resolve to one node, a relation from two outlets is one edge with two sources, and a symmetric relation in opposite directions collapses to a single undirected edge — no duplicate `(src,tgt,relation)` rows. tsc + 13 `node --test` cases pass.

**User stories**: US-6

### What to build
Make accumulation **coherent**. On insert, resolve each entity **QID-first, canonical-name-second** against existing rows; merge aliases onto the matched entity. When the same relation between the same two resolved entities reappears in another article, **append a source** to the existing edge instead of creating a duplicate. Edge corroboration strength = number of `edge_sources` rows.

### Acceptance criteria
- [ ] A public figure appearing in multiple articles (e.g. Netanyahu) resolves to exactly **one** entity node.
- [ ] Aliases discovered across articles accumulate on the single entity.
- [ ] A relationship reported by two articles is a **single edge with two sources**, not two edges.
- [ ] The graph renders edge thickness (or equivalent) proportional to corroboration count.
- [ ] No duplicate `(src, tgt, relation)` edges exist after ingesting overlapping articles.

---

## Phase 4: Review gate + queue

> **Status: DONE, behind a feature flag** (branch `phase-1-tracer-bullet`). The whole gate is toggled by the backend `REVIEW_GATE` env var, **default off**. **On:** freshly extracted edges stay `proposed` and the public graph serves **approved edges only** (`/Edges` → `status='approved'`; `/Nodes` → only approved-connected entities); **off (default):** the graph shows extracted edges directly (`status != 'rejected'`, so auto-rejected ones still stay hidden). The backend gained `GET /config` (`{reviewGate}`, so the frontend hides the review link when off) and two write endpoints — `GET /review/queue?limit=&offset=` (paged proposed edges with entity names, relation, outlet, quote; gate-independent) and `POST /review/:edgeId {action:'approve'|'reject'}` (`graphStore.setEdgeStatus`, typed-guard validated) — plus a minimal decoupled `Pages/Review.tsx` table (Approve/Reject + paging). Phase 5's verification **auto-rejects** unsupported edges so the human only ever sees plausible ones. Verified live (curl) both modes: gate-off shows proposed edges + `/config` false; gate-on hides them until approval, queue lists proposals, approve→in / reject→out, bad action 400 / unknown id 404. tsc clean across all three packages; 15 pipeline + 12 backend `node --test` cases pass.

**User stories**: US-5

### What to build
Introduce the **human-review gate**. Newly extracted edges land as `status='proposed'`. Build a **separate review-queue screen** (decoupled from the graph): a table of proposed relations showing source/target entities, the relation, the outlet, and the supporting quote, with **Approve / Reject** controls, backed by the review endpoints. The graph's query API now serves **approved edges only**.

### Acceptance criteria
- [ ] Freshly extracted edges are `proposed` and do **not** appear in the public graph.
- [ ] The review queue lists proposed edges with entities, relation, outlet, and quote.
- [ ] Approving an edge makes it appear in the graph; rejecting it keeps it out permanently.
- [ ] `search` / `neighbors` endpoints return only `approved` edges and the entities they connect.
- [ ] Queue supports paging through many proposed edges for bulk triage.

---

## Phase 5: Verification pass (anti-hallucination)

> **Status: DONE** (branch `phase-1-tracer-bullet`). A distinct, independently-runnable stage (`npm run verify`) makes a **second Claude call** per extracted edge (`verify.ts`), checking whether the supporting quote actually backs the stated relation/direction (catches denials, swapped direction, wrong pair). Each edge is marked `verification = supported | unsupported` (`runVerification` in `verification.ts`, DI'd verifier, per-edge error isolation, idempotent over `unchecked` edges; `--force` re-checks all). Edges with no quote are auto-marked `unsupported`. Unsupported edges are **auto-rejected** (`status='rejected'`) so they never reach the Phase-4 review queue — keeping the reviewer's load to the minimum. The single headless-Claude spawn/parse is now shared by extraction and verification (`claude.ts`). tsc + 15 pipeline / 8 backend `node --test` cases pass; fixture smoke run verified end-to-end + idempotency on the live DB.

**User stories**: US-7

### What to build
Add a **second Claude call** that, for each extracted relation, checks whether its **supporting quote actually supports the stated relation** (catching misreads like "denied funding" → `funded`, or "allegedly" flattened to fact). Mark each edge `verification = supported | unsupported`. Unsupported edges are auto-rejected or surfaced in the queue **flagged**, so the human reviewer's load is reduced and bad extractions are caught before publication.

### Acceptance criteria
- [ ] Every proposed edge carries a `verification` verdict after the pipeline runs.
- [ ] A deliberately unsupported relation (quote doesn't back the claim) is marked `unsupported`.
- [ ] Unsupported edges are excluded from the graph and clearly flagged (or auto-rejected) in the review queue.
- [ ] The verification step is a distinct, independently runnable stage over already-extracted edges.

---

## Phase 6: Egocentric search + lazy expansion

> **Status: DONE** (branch `phase-1-tracer-bullet`). Backend gained `GET /search?q=` (name/alias match in the visible-graph scope, ranked by degree; empty `q` browses top-degree entities) and `GET /neighbors/:id?limit=N` (focal + 1-hop neighbors, capped, ranked **corroboration → confidence → recency**, returning `{nodes, edges, focalId, shown, total}`). The frontend was rebuilt into a search-first egocentric explorer: a landing hero with debounced autocomplete + suggestion chips → selecting an entity renders the focal node + its neighbors → any node is expandable on demand, accumulating `{nodes, edges}` and a per-node `meta(shown,total)` map; `total>shown` drives a "+N" / "show more" expander. The whole graph is never bulk-loaded. Rewrote `D3NetworkGraph.tsx` (gradient nodes, directed arrowheads, corroboration-weighted links, focal ring, zoom-to-fit, position memory). Backend `tsc` clean + 22 `node --test` cases (9 new for search/neighbors covering alias match, degree ranking, capping, visible scope, orphan, 503); frontend `tsc` + `vite build` clean; 6 Playwright E2E cases green.

**User stories**: US-2, US-3

### What to build
Deliver the headline UX. The app opens to a **search-first** entry: the reader searches an entity by name/alias, the graph renders that **focal entity + its 1-hop neighbors**, and **any node is expandable** to fetch its own neighbors on demand (generalizing the current hardcoded `nodeId: 10` / `graph-addition.json` expansion to hit the `neighbors` endpoint). High-degree nodes are tamed by a **per-expand cap + ranking** (corroboration → confidence → recency) with a **"show more"** affordance.

### Acceptance criteria
- [ ] App opens to a search box; searching returns matching entities by name or alias.
- [ ] Selecting a result renders the focal entity plus its direct neighbors (approved edges only).
- [ ] Expanding any node fetches and merges that node's neighbors via the `neighbors` endpoint.
- [ ] A high-degree node shows a capped, ranked subset with a working "show more".
- [ ] The whole graph is never loaded at once; expansion is incremental.

---

## Phase 7: Provenance & taxonomy UX

> **Status: DONE** (branch `phase-1-tracer-bullet`). The backend now returns the credibility layer the public payload had been dropping: `/Nodes`, `/search`, and `/neighbors` carry each entity's `qid` + `aliases[]`, and `/Edges` + `/neighbors` carry each edge's `category`. The frontend renders the whole thing — a shared `lib/graph.ts` maps the six categories to colors/DOM-safe ids; `D3NetworkGraph` colors edges + per-category arrowheads by category and adds a transparent hit-line so thin edges are clickable; a new `EdgeDetailsPanel` slides in on edge-click showing the category chip, the relation statement, and one source card per `edge_sources` row (outlet `[ynet]` chip linking to the article, published date, exact quote — multi-source edges show multiple chips); a new `CategoryFilter` (bottom-left, replacing the old Legend) toggles edge visibility per category with live counts; `NodeDetailsPanel` gained aliases chips + a linked Wikidata QID; `Pages/Review.tsx` was rebuilt fully RTL/Hebrew on the paper aesthetic with category chips; and `index.html` is now `lang="he" dir="rtl"`. Backend tsc clean + 23 `node --test` cases (new case for category on edges, plus qid/aliases assertions folded into the existing node/search tests); frontend tsc + `vite build` clean; Playwright green — 5 Phase-6 regression + 3 new Phase-7 (edge→sources panel with link+quote, category-filter hides edges, node-panel aliases/QID), the old "provenance not yet surfaced" PROBE flipped to a positive assertion.

**User stories**: US-4, US-8

### What to build
Surface the credibility layer and finish the Hebrew experience. Each edge shows clickable **`[ynet]` source chips** that open the article link and reveal the supporting quote (one chip per source). Relations are **colored by category** with **filters** (family / financial / professional / political / legal / other). Apply **RTL + Hebrew** layout/fonts throughout (the current English demo names hide this work), and enrich the node details panel (canonical name, aliases, description, QID link when present).

### Acceptance criteria
- [ ] Clicking/selecting an edge shows each source with outlet, date, the exact quote, and a working link to the article.
- [ ] Edges are colored by category, and the reader can filter the graph by category.
- [ ] Hebrew entity names and content render correctly RTL across graph, panel, and review queue.
- [ ] The node details panel shows canonical name, aliases, description, and the Wikidata QID (linked) when available.
- [ ] An edge with multiple sources shows multiple chips and its corroboration is visually evident.

---

## Phase 8: Connection finder — "how are these two related?"

> **Status: DONE** (branch `feat/phase8-connection-finder`). Backend `GET /subgraph?from=&to=&maxHops=&exclude=&includeHubs=` returns up to **K=5 vertex-disjoint shortest paths** (undirected walk over the visible graph via a `WITH RECURSIVE` CTE in `graphStore.shortestPath` — fewest hops, tie-broken by weakest-link credibility) plus a flat display-shape node/edge union and `suppressedHubs`. The greedy K-loop + relative top-percentile hub cutoff (default-on, `HUB_PERCENTILE=0.97`, intermediaries only, endpoints always allowed) + exclude-set assembly live in pure `paths.ts` (`findPaths`/`hubThreshold`); `endpoints.getSubgraph` does param validation + the status mapping (400 missing · 422 non-integer or `from===to` · 404 unknown entity · 503 not-ready · 200+`paths:[]` for no-connection). Pipeline gained `idx_edges_src`/`idx_edges_tgt`. Frontend layers the feature onto the explorer (no new page): a `useConnection` hook owns the arm→pick→fetch lifecycle; `NodeDetailsPanel` "מציאת קשר" arms a pick-the-other-endpoint state (chosen by clicking a node **or** typing a possibly-hidden name in `SearchBox`); `D3NetworkGraph` renders focus mode (route nodes/edges lit + glow + `data-route`, everything else dimmed, origin/destination rings, category colors + edge-click provenance preserved); a `ConnectionControls` strip carries the hop slider (2–6), include-hubs toggle, suppressed-hub notice, removable exclude chips, A↔B summary, no-path state, and a clear ✕ that keeps the graph. Backend `tsc` clean + **37 `node --test`** cases (new `paths.test.ts` for the pure logic + `/subgraph` integration cases for paths/hubs/exclude/no-path/status codes); pipeline 55 + frontend `tsc`/`vite build` clean; Playwright **11 green** (5 Phase-6 + 3 Phase-7 regression + 3 new Phase-8: trace-by-typing focus mode, hub suppression + override, click-to-pick + clear).

**User stories**: US-9

### What to build
While exploring, the reader designates a **second endpoint** — by clicking a displayed node *or* typing a name (which may resolve to a currently-hidden entity) — and the explorer overlays up to **K=5 distinct shortest paths** between the two, pulling in any hidden intermediaries the routes pass through. The connection is computed by a new backend endpoint over the visible graph and rendered in a **focus mode** (routes lit up, the surrounding graph dimmed as context), with each route edge still click-through to its sources.

### Design decisions (resolved)

**Algorithm**
- **Output:** up to **K = 5** *distinct* shortest paths, shortest first (`k` is a server constant, not a query param).
- **Traversal:** **undirected** — the edge `directed` flag is ignored while walking, but preserved per-edge for display arrows/phrasing.
- **Distinctness:** **vertex-disjoint intermediates**, found **greedily** (best path → ban its intermediate nodes → repeat up to K). Shared-hub depth is not lost: a hub edge carries all its relations/sources, one click down in `EdgeDetailsPanel`.
- **"Shortest":** **hop count primary**, tie-broken by **weakest-link credibility** — a chain is only as strong as its flimsiest edge, so rank by max-of-min corroboration, then confidence.
- **Hop depth:** user-controlled, **default 3**, hard server cap **6**.
- **Hub handling (hard exclusion):** a **relative top-percentile degree** cutoff applied to **intermediaries only** (the two endpoints are always allowed), **default-on** with an **"include major hubs"** override toggle, plus a **manual `exclude` list** layered on top. Whenever the cutoff suppresses something (a route or the whole result), the UI says so explicitly — **never a silent empty result**.

**Backend API**
- `GET /subgraph?from=&to=&maxHops=&exclude=&includeHubs=`
- **Response:** `{ from, to, paths: [{ nodes:[ids], edges:[ids], hops }], nodes:[<display Node>], edges:[<display Edge + sources[]>], suppressedHubs }` — returns **both** the abstract paths (for ranking/highlighting) **and** a flat display-shape union (so the existing D3 graph + `EdgeDetailsPanel` render with no extra fetches).
- **Status codes:** `400` missing/malformed `from`/`to` · `422` non-integer values *or* `from === to` (well-formed but unprocessable) · `404` an entity id with no matching entity · `503` DB not ready · **`200` + `paths: []`** for "entities exist, no connection within `maxHops`" (a successful negative answer — carries `suppressedHubs` + the widen-search affordances). *(Note: this diverges from the existing `400`-on-non-integer convention in `getNeighbors`/`postReview`; left as-is on the old endpoints, done "right" on the new one — a future cleanup could align them.)*
- Respects the visible-edge gate (reuse `visibleEdgeCondition`).

**Implementation split** (`WITH RECURSIVE`, no new dependency — SQLite is the off-the-shelf traversal engine, already a dep)
- **`graphStore.ts`** — `shortestPath(from, to, excludeIds, maxHops)` via a recursive CTE returning the single best path (fewest hops, then weakest-link) avoiding an exclude set; degree data for the percentile; reuse `entitiesByIds` + `withSources` to hydrate.
- **`paths.ts`** (new, pure logic, no SQL) — the greedy K-loop, the relative hub threshold, exclude-set assembly, `suppressedHubs` accounting, and final `{ paths, nodes, edges }` assembly.
- **`endpoints.ts`** — a thin `getSubgraph` handler (param validation + the status mapping above).
- **pipeline `db.ts`** — add `idx_edges_src` + `idx_edges_tgt` (today's only indexes are on entity name / alias; the recursive adjacency and `getNeighbors` both query `src_entity_id OR tgt_entity_id`). Schema lives in the pipeline (its single owner); the indexes apply on the next pipeline run.

**Frontend** (inside the existing explorer — `Pages/NetworkGraph.tsx`; `Landing` unchanged)
- **Both endpoints user-chosen.** Gesture: a **"trace connection"** button in `NodeDetailsPanel` arms a "pick the other endpoint" state; the second endpoint is then chosen by **clicking a displayed node** *or* **typing a name** (`SearchBox` → `/search`). Always calls `/subgraph` (server-authoritative — surfaces hidden intermediaries even when the second endpoint is already visible).
- **Focus-mode rendering:** dim non-route nodes/edges, light up routes (opacity + weight + glow), **category colors preserved** on route edges, endpoints distinctly marked (origin / destination rings), **edge-click provenance intact**.
- **Control strip** (visible while a connection is active): hop slider (default 3, range 2–6), "include major hubs" toggle, the `suppressedHubs` notice, removable **excluded-node chips** (fed by an "exclude from paths" action), an "A ↔ B" endpoint summary, and a **clear ✕** that exits connection mode but **keeps the accumulated graph**. The **no-path** state lives here ("no connection within N steps — [increase] / [include hubs]").
- **One active connection at a time** — a new connection replaces the previous overlay.

### Acceptance criteria
- [ ] `GET /subgraph?from=&to=` returns up to 5 vertex-disjoint shortest paths plus the flat node/edge union, shortest first.
- [ ] Two entities connected only via a multi-hop chain (no direct edge) return the connecting path(s); two with no connection within `maxHops` return `200` + `paths: []`.
- [ ] The hub cutoff suppresses routes through mega-hubs by default, reports `suppressedHubs`, and the "include major hubs" toggle restores them; a manual `exclude` list is honored.
- [ ] Status codes are correct: `422` on `from === to`, `404` on an unknown entity, `400` on missing params, `503` before the DB exists.
- [ ] In the explorer, "trace connection" + a second endpoint (chosen by click **and** by typing a hidden name) overlays the routes in focus mode, preserving category colors and edge-click provenance.
- [ ] Adjusting the hop slider, toggling hubs, and removing an exclude chip each re-run the search and update the overlay; "clear" returns to normal exploration with the graph intact.
- [ ] Backend `node:test` covers `paths.ts` (shortest, multi-hop, disjoint-K, no-path, hub exclusion + override, manual exclude, the 400/422/404 cases); `tests/phase8.spec.ts` covers the UI flow end-to-end.

## Suggested verification per phase

Each phase is independently demoable: run the pipeline CLI and observe the SQLite contents + the rendered graph (or the review queue). Backend logic (resolution, corroboration, verification verdicts, query endpoints) should get `node --test` coverage following the existing backend test setup; the not-yet-wired Playwright package in `test/` is the natural home for end-to-end checks once the egocentric UX (Phase 6) lands.
