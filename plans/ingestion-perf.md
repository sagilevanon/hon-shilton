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
- Phase D caps a stalled call at ~300s + one retry instead of letting it burn the
  old 360s timeout — a tail-latency / wasted-slot win, not reflected in the means.
  (Originally 210s; **raised to 300s after the live run** — see Phase-C results.)
- These isolate orchestration; a true end-to-end live run (real Claude) is still
  available via `npm run debug-ingest` / `debug-verify` with `--concurrency`.

## Phase C — live eval result (sonnet/default vs prod baseline, 18 re-extractable articles)

Ran `re-extract` (sonnet/default, 600s/conc-3, 0 errors) → `debug-diff` vs the prod
`graph.db`. Candidate was *richer* (154 vs 119 entities, 105 vs 89 edges). Diff:
entities common 81 / dropped 38 / added 73; edges common 30 / dropped 59 / added 75 /
changed 6. Reading the divergences (not just counting):

- **Most divergence is surface-form noise, not semantics.** Two kinds: (1) entity
  canonical-name variants — `צה"ל` vs `צבא ההגנה לישראל`, `ארה"ב` vs `ארצות הברית`,
  `כנסת` vs `הכנסת`, `מח"ש` vs the full name, `סנטקום` vs `פיקוד המרכז…`; (2) **glyph
  inconsistency in names AND relation labels** — Hebrew gershayim `״`/`׳` vs ASCII
  `"`/`'` (`יו"ר של` vs `יו״ר של`, `ח"כ`/`ח״כ`). Both fragment the same fact into a
  drop+add pair. Sonnet was even self-inconsistent (emitted both `צה"ל` and `צבא
  ההגנה לישראל`). → **NEUTRAL semantically, but a real graph-fragmentation cost.**
- **Relation accuracy is comparable.** Additions carry solid verbatim quotes (no
  hallucination seen). On the 6 changed edges sonnet mostly picked *more specific*
  values (`אחר`→`פוליטי`; `מנכ"ל של`, `תבע את` instead of `אחר`) — small
  IMPROVEMENTS; one went vaguer (rector → `אחר`) — minor regression.
- **Caveat:** baseline ≠ clean opus/high re-extract, so some "added" reflects
  article-set/version skew, not model improvement.

**Highest-leverage takeaway (model-independent):** a name+relation-label
**normalization step** (unify `״/׳` with `"/'`, and a small canonical-name/qid
gazetteer for high-frequency entities) would merge a large share of these for *both*
models and lift cross-article corroboration. Worth doing before re-judging models.

**Recommendation:** keep **opus/high** as the documented default for now — sonnet is a
promising speed/cost candidate with comparable *relation* quality, but it regresses on
*canonicalization consistency*, and the cheap baseline can't give a clean regression
count. To switch responsibly: (a) add the normalization step, then (b) re-run the diff
against a **clean opus/high re-extract** reference. Tooling is in place for both.

**Run-time correction from the live run:** at `--concurrency 5` the 210s deadline
killed 2/18 genuinely-successful sonnet calls (each then retried — Phase D working as
intended, but wasting a call); at conc-3 with 600s, 0 errors. Headless `claude` spawns
are far heavier than raw API calls, so 5 concurrent ones drift past a tight deadline.
**Default `GRAPH_EXTRACT_TIMEOUT_MS` raised 210s → 300s** (covers the measured ~298s
solo tail); under sustained load prefer `--concurrency 3–4`.

### Phase C — round 2: opus lower-effort, against a clean opus-4.8/high reference

Re-extracted the same 18 cached bodies under three configs (600s/conc-3, 0 errors
each) and diffed the two candidates against the **clean opus-4.8/high** reference
(same-family → far less canonicalization noise than the sonnet diff).

| config | entities | edges | edge yield vs high |
|---|--:|--:|--:|
| **opus-4.8 / high** (reference) | 155 | 117 | — |
| opus-4.8 / medium | 154 | 108 | **−8%** |
| opus-4.7 / medium | 157 | 97 | **−17%** |

Entity *recognition* is ~equal across all three (~155); effort/version shows up in
**relation richness**, not who gets recognized.

- **opus-4.8/medium ≈ high, with a small real cost.** 131/155 entities (85%) and a
  large share of the edge churn is the same fact re-surfaced as a *more specific*
  relation (`אחר`→`יו״ר של`/`חבר ב`/`תבע את`, murder edge `אחר`→`משפטי`) or a naming
  twin — i.e. NEUTRAL/IMPROVEMENT. The genuine cost: a few **high-value relations
  flattened or dropped** — 3 media-ownership edges lost their `[בעלים של]`
  (אגודת ישראל→המודיע, דגל התורה→יתד נאמן, ש"ס→הדרך), a sibling tie
  (נתניהו↔יונתן `[אח/אחות של]`) dropped, some "mediates-between" diplomacy
  flattened — plus a mild tendency to **lower confidence** (several high→med). For a
  project whose point is ownership/funding ties, those `[בעלים של]` losses are the
  one thing to weigh.
- **opus-4.7/medium is meaningfully worse.** Only 77/155 entities (50%) and 31/117
  edges (26%) common, −17% yield, and noticeably different canonicalization
  (בג"ץ, עיריית בני ברק vs מועצת העיר…). Lower coverage *and* less consistent — no
  upside over 4.8/medium.

**Recommendation:** keep **opus-4.8/high** as the default for best fidelity (esp.
ownership relations). If a latency/cost cut is needed, **opus-4.8/medium** is the
viable candidate — small, identifiable quality cost — and should be paired with the
name/relation-label **normalization step** (it would also dissolve most of the churn
above, which is naming, not semantics). **opus-4.7/medium: not recommended.**

### Phase C — round 3: opus-4.7 effort sweep (the speed lever)

Effort barely moved wall-clock on 4.8 (the ~20k-token per-call harness cache + CLI
startup dominate, not reasoning) — so the real speed lever turned out to be the
**model**. opus-4.7 is markedly faster than 4.8. Full sweep, all 18 bodies, diffed
vs the clean opus-4.8/high reference (wall from epoch markers, conc-3):

| config | edges (yield vs high) | ownership/funding `[בעלים של]`/`[מימן את]` | wall (18 art) | speed |
|---|--:|---|--:|--:|
| **opus-4.8 / high** (reference) | 117 (—) | full | 10.6 min | 1.0× |
| opus-4.8 / medium | 108 (−8%) | 3 dropped/flattened | 8.8 min | 1.19× |
| opus-4.7 / medium | 97 (−17%) | mixed | 3.2 min | 3.3× |
| **opus-4.7 / high** ⭐ | 107 (−8.5%) | **all kept, med→high** | 4.1 min | **2.57×** |
| opus-4.7 / xhigh | 99 (−15%) | 3 dropped | 8.0 min | 1.32× |

- **opus-4.7/high is the recommended speed config.** 2.57× faster than 4.8/high for
  the same −8.5% edge yield as 4.8/medium — but unlike medium it **preserves every
  high-value relation** (the media-ownership trio אגודת ישראל→המודיע, דגל התורה→
  יתד נאמן, ש"ס→הדרך and the funding edge איראן→חיזבאללה→`[מימן את]` are all common
  and upgraded med→high), plus category fixes (`אחר`→`פוליטי`/`משפטי`). Entity
  recognition equal-or-better (161 vs 155).
- **More effort backfired:** 4.7/xhigh took ~2× as long as 4.7/high yet extracted
  *fewer* edges (99) and dropped the ownership trio — over-reasoning pruned good
  relations. The 4.7 effort curve peaks at **high**.
- **Caveat (same as before):** 4.7 canonicalizes some names differently from 4.8
  (כנסת/הכנסת, הצבא הלבנוני/צבא לבנון, סנטקום/פיקוד המרכז) — surface noise, not
  recognition loss; the name/relation-label **normalization step** dissolves it and
  is the prerequisite to adopting any non-4.8/high config cleanly.
- **Reliability note:** the first xhigh run hit the Claude Code **session/usage
  limit** mid-batch (10/18 errored, "resets 4:30pm"); Phase D classified it
  retryable but the retry hit the same cap. Re-run after reset was clean. Takeaway:
  a sustained limit is *not* meaningfully retryable — a future enhancement is to
  detect the session-limit envelope and **abort fast** rather than burn the retry.

**Recommendation (final):** keep **opus-4.8/high** as the default for maximum
fidelity; adopt **opus-4.7/high** when the ~2.5× speedup is worth a bounded −8.5%
yield (it protects the ownership/funding ties that matter most), and only after
adding the **name/relation-label normalization** step. Avoid 4.8/medium (low speed
gain, drops ownership), 4.7/medium (−17%), and 4.7/xhigh (slow, drops ownership).

### Normalization — Layer 1 (glyph) built; measured impact small (Layer 2 is the lever)

Layer 1 (`normalize.ts`, applied in `storeExtraction`): NFC + unify ASCII `"`/`'` and
smart quotes to Hebrew gershayim `״`/geresh `׳` (the form `taxonomy.ts` already uses) +
whitespace. Merges within-run glyph jitter (`יו"ר של`↔`יו״ר של`, `צה"ל`↔`צה״ל`) onto one
node/edge — proven by `normalize.test.ts`.

Quantified via `debug-diff --normalize` over the existing eval DBs (no new calls):

| diff | edges common: raw → normalized |
|---|---|
| opus-4.7/high vs 4.8/high (cross-family) | 45 → 47 (+2) |
| opus-4.8/medium vs 4.8/high (same-family) | 65 → 65 (0) |

**Finding:** glyph noise is a *small* fraction of the divergence. The dominant
fragmentation is **true synonyms** — definite-article variants (`כנסת`/`הכנסת`,
`צבא הגנה`/`צבא ההגנה`), acronym↔full-name (`מח״ש`/`המחלקה לחקירות שוטרים`,
`סנטקום`/`פיקוד המרכז`), alternate phrasings (`הצבא הלבנוני`/`צבא לבנון`). Same-family
opus is glyph-consistent (0 churn); the glyph gap only appears cross-family and is ~2
edges. **Layer 1 is kept** (correct, safe, free, fixes within-model jitter in
production) but **Layer 2 — a curated QID/canonical gazetteer + definite-article
handling — is where the real corroboration gains are** and is the recommended next step.

### Normalization — Layer 2 (gazetteer) — built; recovers the cross-article merges Layer 1 left on the table

`gazetteer.ts`: a curated, high-precision const map of the ~21 highest-frequency
Israeli entities, each `{ canonical_name, qid?, variants[] }`. Seeded from the live
model-divergence dumps (the "only in baseline / only in candidate" entity lists from
`debug-diff`). It folds the synonym classes Layer 1 cannot: acronym↔full-name
(`צה״ל`/`צבא ההגנה לישראל`, `מח״ש`/`המחלקה לחקירות שוטרים`, `סנטקום`/`פיקוד המרכז`),
definite-article variants (`כנסת`/`הכנסת`, `ליכוד`/`הליכוד`) handled conservatively by
listing both forms per entry (no global ה-strip), and alternate phrasings
(`הצבא הלבנוני`/`צבא לבנון`). Resolution is **resolve-time in `db.ts`**: `upsertEntity`
runs `canonicalizeEntity` first, which rewrites a matched variant to the canonical name,
**backfills its QID** (only QIDs verified in the production graph are curated, so a wrong
QID can't fan out a bad merge), and keeps the original spelling as an alias so search still
finds it — then the existing QID→canonical→alias resolution collapses the occurrences.
Matching runs names through `normalize` first, so Layer 1 (glyph) and Layer 2 (synonym)
compose. Proven by `gazetteer.test.ts` (variant lookup + two cross-article
`storeExtraction` merges: `כנסת`+`הכנסת` and `צה״ל`+`צבא ההגנה לישראל` each collapse to one
node with corroboration `value`=2).

Measured **free** (no Claude calls) via a new `debug-diff --gazetteer` key mode
(`diff.ts` `gazetteerKey`: fold a synonym onto its QID-or-canonical, else glyph-normalize),
run over the existing eval DBs. Common entities/edges rising = churn falling:

| diff (same article bodies) | edges common: raw → normalized → **gazetteer** | entities dropped/added: raw → **gazetteer** |
|---|---|---|
| opus-4.7/high vs 4.8/high (the new default vs the max-fidelity ref) | 45 → 47 → **55** (+8 over Layer 1) | 82/88 → **79/86** |
| opus-4.8/med vs 4.8/high (same family, effort gap) | 65 → 65 → **69** (+4) | 24/23 → **22/20** |

**Finding:** where Layer 1 recovered ~2 cross-family edges, Layer 2 recovers **8 more on
top** (a +17% lift in cross-model edge agreement for the default config) — confirming the
prediction that true synonyms, not glyph noise, were the dominant fragmentation. Within a
single extraction run the collapse is ~0 (a model is self-consistent within one run); the
gain is entirely **cross-article/cross-run corroboration**, exactly what the served graph's
edge-thickness depends on. Both layers are kept; the gazetteer is the lever and is extended
by adding entries (regenerate variant lists from `debug-diff` dumps as the corpus grows).

**Phase C** is tooling-complete (`re-extract` + `debug-diff`) and now exercised live
across five model/effort configs. **Decision (2026-06-27): the pipeline default is now
opus-4.7/high** (`claude.ts` `resolveModelConfig`: `GRAPH_EXTRACT_MODEL=claude-opus-4-7`,
`GRAPH_EXTRACT_EFFORT=high`) for the ~2.5× speedup; set `GRAPH_EXTRACT_MODEL=claude-opus-4-8`
for maximum fidelity. The name/relation-label **normalization step** is the recommended
follow-up before relying on cross-article corroboration under the new default.

## Out of scope (revisit only if A–D fall short)
- Direct Anthropic API / Batch API (would reverse D1 — the no-API-key principle).
- Caching/reusing the Claude-Code system-prompt cache across spawns (harness-level).
- Sources beyond ynet; any change to the schema or the served-graph contract.
