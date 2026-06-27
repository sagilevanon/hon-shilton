# Plan: Dramatically reduce ingestion runtime (without major quality loss)

> Source: 2026-06-27 profiling session. A debug timing layer (`GRAPH_DEBUG_TIMING`,
> `npm run debug-ingest` / `debug-verify`) was added to the pipeline and run live
> against the ynet feed with the production setup (**extraction = opus/high**,
> **verification = sonnet**). This plan turns those measurements into a sequenced
> optimization. Diagnosis is done and committed to below; nothing here is built yet.

## The measured problem

Per-article wall-clock, opus/high extraction (n=8 items, 6 successful):

| Sub-step | Mean | Median | Max | % of wall |
|---|--:|--:|--:|--:|
| `http_fetch` | 1.5s | 0.13s | 5.8s | ~1% |
| `parse` / `db_cache` / `db_store` | <0.1s | — | 0.17s | ~0% |
| **`extract` (Claude opus/high)** | **137.6s** | **99.0s** | **297.6s** | **97%** |
| `sleep` (inter-item politeness) | 2.0s | 2.0s | — | ~1% |

Inside a successful extract call (mean): wall **115.6s** = 1.8s CLI startup + 113.8s model loop, of which **time-to-first-token is 72s (62%)** — pure high-effort reasoning latency. Each call also re-creates ~20k tokens of Claude-Code system-prompt/tool cache (no reuse across spawns). Verify on sonnet: 15.6s/call, 11.5s TTFT, but **once per edge** (~7.7 edges/article ≈ 120s of verify per article — comparable to extraction in aggregate).

Two failure modes, both reproduced: (1) an Opus call **stalled mid-stream at 266s** (`"Response stalled mid-stream"`, $0.15 for zero output) — the source of "URLs timing out"; (2) one ynet **fetch failed fast** (network blip, not the 25s http timeout).

**Conclusion: runtime is reasoning-bound and per-call-serialized. The levers, in priority order, are parallelism → verify batching → effort/model tuning → stall guard.**

## Decisions (defaults; override before Phase A)

- **D1 — API boundary: stay on the Claude Code login (no API key).** Matches the
  POC principle in `CLAUDE.md` / `plans/hon-shilton-poc.md`. We get ~5× from
  parallelism + tuning without it. *Override:* allowing an `ANTHROPIC_API_KEY`
  would unlock the Batch API (~50% cheaper, high-throughput) and drop the ~20k
  per-call harness cache overhead — revisit only if Phases A–C are insufficient.
- **D2 — model strategy: choose by diffing candidates against the existing records
  (Phase C).** The current `graph.db` (built with opus/high) is the reference. Re-run
  extraction with candidate configs (sonnet, and/or lower effort) over the **same
  cached article bodies**, rebuild a parallel graph, and **diff it against the existing
  records** — count divergences and judge their quality. Don't guess the cost of a
  cheaper config; measure it as a diff.

## Targets

| | Now (serial, opus/high) | After A+B | After A+B+C |
|---|--:|--:|--:|
| 8-article batch, end-to-end | ~30+ min | ~6 min | ~3 min (target) |
| Approx. speedup | 1× | ~5× | ~10× |

Quality gate by phase: **A, B, D don't change the model**, so their output must
match the existing records exactly (B may change verify *verdicts* — those are
checked against the per-edge baseline). **C is the only phase that alters output
quality**, and it's evaluated by diffing the candidate graph against the existing
records (see Phase C). The fixed article set + timing baseline are captured in
Phase A step 1.

---

## Phase A: Parallelize the Claude calls (biggest win, zero quality risk)

> **Why first:** ~97% of wall-clock is independent per-article Claude calls run in
> a serial loop. Parallelizing them is a pure latency win — identical model, identical
> prompts, identical output. The only ordering constraint is the SQLite write.

**The invariant that makes this safe:** `storeExtraction` → `upsertEntity` does
cross-article entity resolution (QID → name → alias) and `findOrCreateEdge` dedupes
edges. Two articles resolving "נתניהו" concurrently would race into duplicate nodes.
So: **the Claude `extract` calls run concurrently; the DB writes stay serial.**

### What to build
1. **Capture the baseline** first: run `debug-ingest` on a fixed list of ~10 article
   URLs (pin them in a fixture file so re-runs compare like-for-like), record yield +
   timings. This is the quality/speed reference for all later phases.
2. A small **bounded-concurrency pool** helper (no new deps — a fixed-size worker
   loop over a queue, `Promise`-based). Add to `feed.ts` / a new `pool.ts`.
3. Restructure `runFeed`: split each item into **fetch+extract (parallel, pure)** and
   **store (serial, ordered)**. Concretely — a producer runs N fetch+extract workers;
   completed `{article, extraction}` results are drained by a **single** consumer that
   calls `storeExtraction` one at a time (preserves resolution correctness). Per-item
   error isolation is preserved (a failed extract drops that item, doesn't abort).
4. **Fetch politeness preserved independently:** the 2s `sleep` exists to be polite to
   *ynet's web server*, not the Claude API. Keep a small fetch-side delay/concurrency
   cap (e.g. ≤2 concurrent fetches) even while extraction concurrency is higher.
5. **Concurrency is a flag** (`--concurrency N`, **default 5** — the modeled sweet
   spot: captures most of the speedup while staying conservative on CC-subscription
   rate limits). Confirm on the first real batch by watching the debug log for
   429 / overload / stalls; dial down if unstable, up only if clean. Extraction and
   verification share the one default for now (verify could tolerate more — split
   later only if it's the laggard).

### Acceptance criteria
- [ ] A batch of N articles issues up to `--concurrency` extract calls at once
      (verifiable in the debug log timestamps / a concurrency gauge).
- [ ] DB writes remain serialized; **no duplicate `(src,tgt,relation)` edges or
      duplicate entity nodes** vs. the serial baseline on the same article set.
- [ ] Entity/relation yield matches the Phase-A baseline (same articles, same model).
- [ ] One failed fetch/extract isolates to that item; the batch completes.
- [ ] Measured ~3–5× wall-clock reduction on the 8–10 article batch.

---

## Phase B: Batch verification per article (big verify win, low risk)

> **Why:** verify is cheap per call but runs **once per edge** — ~7.7 calls/article,
> each paying 11.5s TTFT + ~14k cache tokens. One call per article that returns an
> array of verdicts collapses that overhead ~7×, and the parallel pool from Phase A
> applies to the (now far fewer) verify calls too.

### What to build
1. Change `verify.ts` to accept **a list of claims for one article** and return a
   **parallel array of verdicts** (extend the schema to an array; keep the same
   per-claim fact-check instructions). `runVerification` groups `getEdgesToVerify`
   rows by article, one Claude call per group.
2. Keep the **auto-reject of unsupported edges** and **idempotency over `unchecked`**
   semantics unchanged — only the call granularity changes.
3. Run the batched verify calls through the **Phase-A concurrency pool**.
4. Guard against the model returning the wrong array length / misaligned verdicts
   (fall back to per-edge on mismatch, logged).

### Acceptance criteria
- [ ] Verify issues ~1 call per article instead of ~1 per edge.
- [ ] Same verdicts as the per-edge baseline on a fixed edge set (the deliberately
      unsupported edge is still caught and auto-rejected).
- [ ] Verification stage wall-clock drops markedly (~5–7×) on the batch.

---

## Phase C: Choose the model/effort by diffing against existing records (the TTFT lever)

> **Why:** the 72s TTFT is the high-effort reasoning budget, not prompt length —
> prompt engineering won't move it; effort/model will. The candidates are
> **switching to sonnet and/or lowering effort**. But extraction (Hebrew NER +
> relation grounding) is the hard task, so we **measure** the cost — as a **diff
> against the existing records**, which are the source of truth. Data point in hand:
> sonnet/default verify TTFT is 11.5s vs opus/high's 72s.

### The method
The current `graph.db` is the reference graph (the existing records). For each
candidate config we rebuild a parallel graph **over the same article text** and diff:

1. **Reuse cached bodies as input.** Read every `status='ok'` article's `raw_body`
   from the existing DB and re-extract from *that* — **no re-fetch, no re-scrape**.
   This isolates the model/effort as the only variable and treats the stored articles
   as the source-of-truth input. (Needs a small "re-extract from cached body" path:
   today `ingestOne` either uses the cache *and skips extraction*, or `--force`
   *re-fetches*; neither re-extracts a cached body.)
2. **Rebuild into a scratch DB per config**, using the **same `storeExtraction` /
   resolution** as production, so entity-resolution + edge-dedup are identical and
   only extraction differs.
3. **Diff candidate graph vs. existing records** (a `debug-diff` tool):
   - entities: only-in-baseline / only-in-candidate / common (keyed by qid, else
     canonical_name — a near-miss canonical name surfaces as a drop+add pair, which
     is itself useful signal about naming consistency);
   - edges: only-in-baseline (**dropped**) / only-in-candidate (**added**) / common,
     keyed on `(src, tgt, relation)`; for common edges flag `category` / `confidence`
     / `directed` changes;
   - report **counts** plus, for each divergent edge, the article URL + supporting
     **quote** so divergences can be judged, not just tallied.
4. **Judge diff quality, not just quantity.** A divergence is not automatically a
   regression — opus/high is the current baseline, *not* ground truth, so a "dropped"
   edge may be opus over-extraction and an "added" edge may be a genuine find or a
   hallucination. Classify each divergence as **regression / improvement / neutral**
   by reading the article + quote (optionally an automated Claude *judge* call over
   the divergence set to pre-label, with human review on a sample).
5. **Pick the config** with the best speed gain whose divergences are dominated by
   neutral/improvement (few real regressions). Set it as the pipeline default via
   `GRAPH_EXTRACT_MODEL` / `GRAPH_EXTRACT_EFFORT` (effort pinning was added in the
   profiling session, so the default is deterministic, not inherited) and document it.

Candidates to run, at minimum: **opus/medium**, **sonnet/default**, **sonnet/low** —
each diffed against the opus/high reference.

### Acceptance criteria
- [ ] A "re-extract from cached body" path exists (reuses stored articles, no re-fetch).
- [ ] `debug-diff` reports entity/edge add/drop/change counts between two graph DBs,
      with article URL + quote attached to every divergence.
- [ ] For each candidate config: a divergence table vs. the existing records + its
      measured TTFT/wall, with divergences classified regression/improvement/neutral.
- [ ] A chosen default config documented, justified by *low real-regression count* at
      a materially better latency — not by raw diff count alone.
- [ ] End-to-end batch hits the ~10× target (Phase A+B+C stacked) with regressions
      against the existing records kept negligible.

---

## Phase D: Stall / retry guard (reliability, complements parallelism)

> **Why:** the 266s mid-stream stall produced nothing and still cost $0.15; the
> current 360s `GRAPH_EXTRACT_TIMEOUT_MS` lets a stuck call burn ~6 min before
> failing. Under parallelism a stalled worker also wastes a pool slot.

### What to build
1. A **shorter per-call timeout** tuned above the observed p95 successful wall
   (successful max was ~298s; pick e.g. 180–210s as a soft deadline) with **one
   automatic retry** on timeout / `is_error` / stall before giving up on the item.
2. Detect the `is_error: true` envelope (e.g. `"Response stalled mid-stream"`) in
   `claude.ts` and treat it as a retryable failure, not a hard exit.
3. Keep per-item error isolation: exhausted retries → item recorded as error, batch
   continues.

### Acceptance criteria
- [ ] A stalled/timed-out call is retried once, then isolated — never aborts the batch.
- [ ] `is_error` envelopes are classified as retryable (not silently treated as success).
- [ ] No regression in successful-call latency from the tighter deadline.

---

## Sequencing & rollback

A → B → D are independent, low-risk, and stack; do **A first** (largest win, no
quality question). **C** is the only one touching output quality — gate it behind the
diff-against-existing-records evaluation and keep opus/high as the documented fallback.
Each phase is independently measurable with the existing debug harness; if a candidate
config's divergences show real regressions against the existing records, fall back to a
safer config (or opus/high) and keep the Phase-A/B/D wins.

---

## Results (after — Phases A, B, D built; C tooling built)

Phases A/B/D change orchestration + reliability, **not the model**, so the win is
structural and measured by running the *real* `runFeed` / `runVerification` against
a stub model call of fixed latency (`npm run bench`), then projecting with the
measured per-call means above. Same code paths, model held constant.

**Simulated (8 articles, 8 edges/article = 64 edges; extract stub 300ms, verify stub 150ms/call):**

| Stage | Before | After (conc=5) | Speedup |
|---|--:|--:|--:|
| Extraction (`runFeed`) | 2.41s serial | 0.60s | ×4.0 |
| Verification (`runVerification`) | 9.63s / 64 calls | 0.30s / **8 calls** | ×31.8 |

**Projected real-world (measured means: extract 115.6s/call, verify 15.6s/call; 8 articles):**

| | Before (serial, opus/high) | After A+B (conc=5) | Speedup |
|---|--:|--:|--:|
| Extraction | 15.4 min | 3.9 min | ×4.0 |
| Verification | 16.6 min (per-edge) | 0.5 min (1 call/article) | ×32 |
| **End-to-end** | **~32 min** | **~4.4 min** | **×7.3** |

Notes:
- Phase A's ×4 (not ×5) is `ceil(8/5)=2` extract waves at concurrency 5; an 8-item
  batch can't fill 5 slots twice. Bigger batches approach ×5; conc=10 measured ×8.0.
- Phase B compounds parallelism (pool) with batching (1 call/article instead of
  ~8), hence the larger multiple.
- Phase D caps a stalled call at ~210s + one retry instead of letting it burn the
  old 360s timeout — a tail-latency / wasted-slot win, not reflected in the means.
- These isolate orchestration; a true end-to-end live run (real Claude) is still
  available via `npm run debug-ingest` / `debug-verify` with `--concurrency`.

**Phase C** is tooling-complete (`re-extract` + `debug-diff`); picking a cheaper
default model/effort still needs a live evaluation run. Until then opus/high stays
the documented default (`GRAPH_EXTRACT_MODEL`/`GRAPH_EXTRACT_EFFORT`).

## Out of scope (revisit only if A–D fall short)
- Direct Anthropic API / Batch API (would reverse D1 — the no-API-key principle).
- Caching/reusing the Claude-Code system-prompt cache across spawns (harness-level).
- Sources beyond ynet; any change to the schema or the served-graph contract.
