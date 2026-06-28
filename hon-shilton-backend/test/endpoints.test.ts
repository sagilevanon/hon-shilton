import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { buildApp } from '../server/app.js';
import { initStore } from '../server/graphStore.js';

// Minimal subset of the pipeline's schema — enough for the read/review queries.
// edge 1 approved (public graph), edge 2 proposed (awaiting review), edge 3
// rejected (auto-rejected by verification — never visible).
function buildPopulatedDb(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE entities (id INTEGER PRIMARY KEY AUTOINCREMENT, qid TEXT, canonical_name TEXT NOT NULL,
      type TEXT NOT NULL, subtype TEXT, description TEXT, image TEXT) STRICT;
    CREATE TABLE aliases (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER, alias TEXT) STRICT;
    CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, src_entity_id INTEGER, tgt_entity_id INTEGER,
      relation TEXT, category TEXT, subcategory TEXT, confidence TEXT, status TEXT DEFAULT 'proposed',
      verification TEXT DEFAULT 'unchecked', directed INTEGER DEFAULT 1) STRICT;
    CREATE TABLE edge_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, edge_id INTEGER, url TEXT, outlet TEXT,
      published_date TEXT, quote TEXT) STRICT;
  `);
  db.prepare("INSERT INTO entities (qid, canonical_name, type) VALUES ('Q123', 'בנימין נתניהו', 'person')").run();
  db.prepare("INSERT INTO entities (canonical_name, type, subtype) VALUES ('הליכוד', 'organization', 'political_party')").run();
  db.prepare("INSERT INTO aliases (entity_id, alias) VALUES (1, 'Netanyahu')").run();
  db.prepare("INSERT INTO aliases (entity_id, alias) VALUES (1, 'ביבי')").run();
  db.prepare("INSERT INTO edges (src_entity_id, tgt_entity_id, relation, category, confidence, status) VALUES (1, 2, 'חבר ב', 'פוליטי', 'high', 'approved')").run();
  db.prepare("INSERT INTO edge_sources (edge_id, url, outlet, quote) VALUES (1, 'http://x', 'ynet', 'q')").run();
  db.prepare("INSERT INTO edges (src_entity_id, tgt_entity_id, relation, category, confidence, status) VALUES (1, 2, 'תרם ל', 'כספים', 'med', 'proposed')").run();
  db.prepare("INSERT INTO edge_sources (edge_id, url, outlet, quote) VALUES (2, 'http://y', 'ynet', 'נתניהו תרם להליכוד')").run();
  db.prepare("INSERT INTO edges (src_entity_id, tgt_entity_id, relation, category, confidence, status, verification) VALUES (1, 2, 'מימן את', 'כספים', 'low', 'rejected', 'unsupported')").run();
  db.prepare("INSERT INTO edge_sources (edge_id, url, outlet, quote) VALUES (3, 'http://z', 'ynet', 'denied')").run();
  db.close();
}

// Hub-and-spoke DB for the egocentric endpoints: entity 1 is a degree-4 hub with
// links of varying corroboration/confidence/recency; entity 6 is an orphan
// (no edges). Lets us assert ranking, capping, alias search, and visible scope.
function buildEgoDb(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE entities (id INTEGER PRIMARY KEY AUTOINCREMENT, qid TEXT, canonical_name TEXT NOT NULL,
      type TEXT NOT NULL, subtype TEXT, description TEXT, image TEXT) STRICT;
    CREATE TABLE aliases (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER, alias TEXT) STRICT;
    CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, src_entity_id INTEGER, tgt_entity_id INTEGER,
      relation TEXT, category TEXT, subcategory TEXT, confidence TEXT, status TEXT DEFAULT 'approved',
      verification TEXT DEFAULT 'supported', directed INTEGER DEFAULT 1, created_at TEXT) STRICT;
    CREATE TABLE edge_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, edge_id INTEGER, url TEXT, outlet TEXT,
      published_date TEXT, quote TEXT) STRICT;
  `);
  const ent = db.prepare('INSERT INTO entities (canonical_name, type) VALUES (?, ?)');
  ['בנימין נתניהו', 'הליכוד', 'יואב גלנט', 'אלוני בע״מ', 'קרן ג׳', 'יתום נטול קשרים'].forEach((n, i) =>
    ent.run(n, i === 0 || i === 2 ? 'person' : 'organization'),
  );
  db.prepare("INSERT INTO aliases (entity_id, alias) VALUES (1, 'Netanyahu')").run();

  const edge = db.prepare(
    `INSERT INTO edges (src_entity_id, tgt_entity_id, relation, category, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  edge.run(1, 2, 'חבר ב', 'פוליטי', 'high', '2024-01-01'); // e1: corroboration 2 (top)
  edge.run(1, 3, 'מינה את', 'פוליטי', 'med', '2024-02-01'); // e2: corr 1, med
  edge.run(1, 4, 'תרם ל', 'כספים', 'low', '2024-03-01'); // e3: corr 1, low
  edge.run(1, 5, 'בעל עניין ב', 'כספים', 'high', '2024-04-01'); // e4: corr 1, high
  edge.run(3, 4, 'עובד ב', 'מקצועי', 'med', '2024-05-01'); // e5: second-hop, not a neighbor of 1

  const src = db.prepare('INSERT INTO edge_sources (edge_id, url, outlet, quote) VALUES (?, ?, ?, ?)');
  src.run(1, 'http://a', 'ynet', 'q1');
  src.run(1, 'http://b', 'haaretz', 'q1b'); // e1 corroborated twice
  src.run(2, 'http://c', 'ynet', 'q2');
  src.run(3, 'http://d', 'ynet', 'q3');
  src.run(4, 'http://e', 'ynet', 'q4');
  src.run(5, 'http://f', 'ynet', 'q5');
  db.close();
}

// Path-finder DB (mirrors test/paths.test.ts): A=1 B=2 C=3 D=4 E=5 F=6 HUB=7.
// A-B-C-D chain, A-E-D 2-hop alt, A-HUB-D via hub; HUB also links B,C,E,F so it
// is the lone high-degree hub, and F hangs off HUB only (unreachable without it).
function buildPathDb(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE entities (id INTEGER PRIMARY KEY AUTOINCREMENT, qid TEXT, canonical_name TEXT NOT NULL,
      type TEXT NOT NULL, subtype TEXT, description TEXT, image TEXT) STRICT;
    CREATE TABLE aliases (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER, alias TEXT) STRICT;
    CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, src_entity_id INTEGER, tgt_entity_id INTEGER,
      relation TEXT, category TEXT, subcategory TEXT, confidence TEXT, status TEXT DEFAULT 'approved',
      verification TEXT DEFAULT 'supported', directed INTEGER DEFAULT 1, created_at TEXT) STRICT;
    CREATE TABLE edge_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, edge_id INTEGER, url TEXT, outlet TEXT,
      published_date TEXT, quote TEXT) STRICT;
  `);
  const ent = db.prepare('INSERT INTO entities (canonical_name, type) VALUES (?, ?)');
  ['A', 'B', 'C', 'D', 'E', 'F', 'HUB'].forEach((n) => ent.run(n, 'organization'));
  const edge = db.prepare(
    "INSERT INTO edges (src_entity_id, tgt_entity_id, relation, category, subcategory, confidence) VALUES (?, ?, 'קשור', 'אחר', 'יחסים דיפלומטיים', 'med')",
  );
  const pairs: Array<[number, number]> = [
    [1, 2], [2, 3], [3, 4], [1, 5], [5, 4], [1, 7], [7, 4], [7, 2], [7, 3], [7, 5], [7, 6],
  ];
  const src = db.prepare("INSERT INTO edge_sources (edge_id, url, outlet, quote) VALUES (?, ?, 'ynet', 'q')");
  pairs.forEach(([s, t], i) => {
    edge.run(s, t);
    src.run(i + 1, `http://e${i + 1}`);
  });
  db.close();
}

describe('graph + review API (SQLite-backed)', () => {
  let tmp: string;
  let empty: string;
  let seq = 0;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'honshilton-'));
    empty = path.join(tmp, 'empty.db');
    new DatabaseSync(empty).close(); // exists, but has no graph tables
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // A fresh, isolated DB per test (the review tests mutate state).
  function freshDb(): string {
    const p = path.join(tmp, `graph-${seq++}.db`);
    buildPopulatedDb(p);
    return p;
  }

  // Fastify's in-process test driver is inject(); this wraps it in the
  // supertest-shaped surface the assertions use (.get/.post().send() → {status, body}).
  // The app builds lazily so appWith() stays synchronous and callers needn't await it.
  function appWith(dbPath: string, reviewGate = false) {
    initStore(dbPath, { reviewGate });
    let app: ReturnType<typeof buildApp> | null = null;
    const ready = () => (app ??= buildApp());
    const inject = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
      const res = await (await ready()).inject({ method, url, payload });
      return { status: res.statusCode, body: res.json() };
    };
    return {
      get: (url: string) => inject('GET', url),
      post: (url: string) => ({ send: (payload: unknown) => inject('POST', url, payload) }),
    };
  }

  describe('review gate OFF (default)', () => {
    it('reports the flag as off via /config', async () => {
      const r = await appWith(freshDb()).get('/config');
      assert.deepEqual(r.body, { reviewGate: false });
    });

    it('serves proposed + approved edges but never rejected ones', async () => {
      const r = await appWith(freshDb()).get('/Edges');
      assert.equal(r.status, 200);
      assert.equal(r.body.length, 2, 'approved + proposed visible, rejected hidden');
      const relations = r.body.map((e: { relation: string }) => e.relation).sort();
      assert.deepEqual(relations, ['חבר ב', 'תרם ל']);
    });

    it('returns category on each edge (drives coloring + filters)', async () => {
      const r = await appWith(freshDb()).get('/Edges');
      const byRelation = Object.fromEntries(r.body.map((e: { relation: string; category: string }) => [e.relation, e.category]));
      assert.equal(byRelation['חבר ב'], 'פוליטי');
      assert.equal(byRelation['תרם ל'], 'כספים');
    });

    it('serves the entities connected by a visible edge, with qid + aliases', async () => {
      const r = await appWith(freshDb()).get('/Nodes');
      assert.equal(r.body.length, 2);
      const bibi = r.body.find((n: { name: string }) => n.name === 'בנימין נתניהו');
      assert.equal(bibi.qid, 'Q123');
      assert.deepEqual([...bibi.aliases].sort(), ['Netanyahu', 'ביבי']);
      const likud = r.body.find((n: { name: string }) => n.name === 'הליכוד');
      assert.deepEqual(likud.aliases, [], 'an entity with no aliases gets an empty array');
    });
  });

  describe('review gate ON', () => {
    it('reports the flag as on via /config', async () => {
      const r = await appWith(freshDb(), true).get('/config');
      assert.deepEqual(r.body, { reviewGate: true });
    });

    it('serves approved edges only, with corroboration count and provenance', async () => {
      const r = await appWith(freshDb(), true).get('/Edges');
      assert.equal(r.status, 200);
      assert.equal(r.body.length, 1, 'only the approved edge is in the public graph');
      const e = r.body[0];
      assert.equal(e.relation, 'חבר ב');
      assert.equal(e.value, 1);
      assert.ok(Array.isArray(e.sources) && e.sources[0].quote === 'q');
    });

    it('serves only entities connected by an approved edge', async () => {
      const r = await appWith(freshDb(), true).get('/Nodes');
      assert.equal(r.body.length, 2);
      assert.ok('id' in r.body[0] && 'name' in r.body[0] && 'group' in r.body[0]);
    });

    it('approving a proposed edge moves it into the graph and out of the queue', async () => {
      const api = appWith(freshDb(), true);
      const approve = await api.post('/review/2').send({ action: 'approve' });
      assert.equal(approve.status, 200);
      assert.equal((await api.get('/Edges')).body.length, 2, 'approved edge now appears');
      assert.equal((await api.get('/review/queue')).body.total, 0, 'nothing left to review');
    });

    it('rejecting a proposed edge keeps it out of both graph and queue', async () => {
      const api = appWith(freshDb(), true);
      await api.post('/review/2').send({ action: 'reject' });
      assert.equal((await api.get('/Edges')).body.length, 1, 'rejected edge never enters the graph');
      assert.equal((await api.get('/review/queue')).body.total, 0, 'rejected edge leaves the queue permanently');
    });
  });

  describe('review queue (gate-independent)', () => {
    it('lists proposed edges with entities, outlet, and quote', async () => {
      const r = await appWith(freshDb()).get('/review/queue');
      assert.equal(r.status, 200);
      assert.equal(r.body.total, 1);
      assert.equal(r.body.items.length, 1);
      const item = r.body.items[0];
      assert.equal(item.relation, 'תרם ל');
      assert.equal(item.source, 'בנימין נתניהו');
      assert.equal(item.target, 'הליכוד');
      assert.equal(item.sources[0].outlet, 'ynet');
      assert.equal(item.sources[0].quote, 'נתניהו תרם להליכוד');
    });

    it('paging caps and offsets the queue', async () => {
      const api = appWith(freshDb());
      const first = await api.get('/review/queue?limit=0&offset=0'); // limit clamps to >=1
      assert.equal(first.body.items.length, 1);
      const past = await api.get('/review/queue?limit=10&offset=5');
      assert.equal(past.body.total, 1, 'total ignores paging');
      assert.equal(past.body.items.length, 0, 'offset past the end yields no rows');
    });

    it('rejects a bad action with 400 and an unknown edge with 404', async () => {
      const api = appWith(freshDb());
      assert.equal((await api.post('/review/2').send({ action: 'maybe' })).status, 400);
      assert.equal((await api.post('/review/999').send({ action: 'approve' })).status, 404);
    });
  });

  describe('egocentric search + neighbors (Phase 6)', () => {
    function ego() {
      const p = path.join(tmp, `ego-${seq++}.db`);
      buildEgoDb(p);
      return appWith(p);
    }

    it('search matches canonical name and returns degree', async () => {
      const r = await ego().get('/search?q=נתני');
      assert.equal(r.status, 200);
      assert.equal(r.body.length, 1);
      assert.equal(r.body[0].name, 'בנימין נתניהו');
      assert.equal(r.body[0].degree, 4);
    });

    it('search matches an alias', async () => {
      const r = await ego().get('/search?q=Netan');
      assert.equal(r.body.length, 1);
      assert.equal(r.body[0].id, 1);
      assert.deepEqual(r.body[0].aliases, ['Netanyahu'], 'aliases ride along for the node panel');
    });

    it('empty query browses the most-connected entities first', async () => {
      const r = await ego().get('/search');
      assert.ok(r.body.length >= 4);
      assert.equal(r.body[0].id, 1, 'the degree-4 hub ranks first');
    });

    it('search excludes entities with no visible edges', async () => {
      const r = await ego().get('/search?q=יתום');
      assert.equal(r.body.length, 0);
    });

    it('neighbors returns the focal node plus its 1-hop neighbors', async () => {
      const r = await ego().get('/neighbors/1');
      assert.equal(r.status, 200);
      assert.equal(r.body.focalId, 1);
      assert.equal(r.body.total, 4);
      assert.equal(r.body.shown, 4);
      assert.equal(r.body.edges.length, 4);
      assert.equal(r.body.nodes.length, 5, 'focal + 4 neighbors');
      assert.ok(r.body.nodes.some((n: { id: number }) => n.id === 1));
      assert.ok(r.body.edges.every((e: { category: string }) => typeof e.category === 'string'));
    });

    it('caps and ranks: corroboration → confidence → recency', async () => {
      const r = await ego().get('/neighbors/1?limit=2');
      assert.equal(r.body.shown, 2);
      assert.equal(r.body.total, 4, 'total ignores the cap (drives "show more")');
      const relations = r.body.edges.map((e: { relation: string }) => e.relation);
      assert.deepEqual(relations, ['חבר ב', 'בעל עניין ב'], 'corroboration=2 first, then high-confidence');
      assert.equal(r.body.edges[0].value, 2, 'corroboration count surfaces as value');
    });

    it('a higher limit reaches the rest of the neighbors (show more)', async () => {
      const r = await ego().get('/neighbors/1?limit=8');
      assert.equal(r.body.shown, 4);
      assert.equal(r.body.total, 4);
    });

    it('an orphan entity yields just itself, no edges', async () => {
      const r = await ego().get('/neighbors/6');
      assert.equal(r.body.total, 0);
      assert.equal(r.body.edges.length, 0);
      assert.equal(r.body.nodes.length, 1);
      assert.equal(r.body.nodes[0].id, 6);
    });

    it('rejects a non-integer entity id with 400', async () => {
      assert.equal((await ego().get('/neighbors/abc')).status, 400);
    });
  });

  describe('connection finder /subgraph (Phase 8)', () => {
    function paths() {
      const p = path.join(tmp, `paths-${seq++}.db`);
      buildPathDb(p);
      return appWith(p);
    }

    it('returns vertex-disjoint shortest paths + a flat union, shortest first', async () => {
      const r = await paths().get('/subgraph?from=1&to=4');
      assert.equal(r.status, 200);
      assert.equal(r.body.from, 1);
      assert.equal(r.body.to, 4);
      assert.deepEqual(r.body.paths.map((p: { nodes: number[] }) => p.nodes), [[1, 5, 4], [1, 2, 3, 4]]);
      assert.deepEqual(r.body.paths.map((p: { hops: number }) => p.hops), [2, 3]);
      // The flat union hydrates display nodes + edges (with sources) for the routes.
      assert.deepEqual(r.body.nodes.map((n: { id: number }) => n.id).sort((a: number, b: number) => a - b), [1, 2, 3, 4, 5]);
      assert.ok(r.body.edges.every((e: { sources: unknown[] }) => Array.isArray(e.sources)));
      assert.ok(
        r.body.edges.every((e: { subcategory: string }) => e.subcategory === 'יחסים דיפלומטיים'),
        'the free-text subcategory label rides along on every "other" edge',
      );
      assert.ok(!r.body.nodes.some((n: { id: number }) => n.id === 7), 'the hub is excluded by default');
    });

    it('default-suppresses major hubs and reports them; the override restores them', async () => {
      const off = await paths().get('/subgraph?from=1&to=4');
      assert.deepEqual(off.body.suppressedHubs.map((n: { id: number }) => n.id), [7]);

      const on = await paths().get('/subgraph?from=1&to=4&includeHubs=1');
      assert.deepEqual(on.body.suppressedHubs, []);
      assert.ok(on.body.nodes.some((n: { id: number }) => n.id === 7), 'the hub now carries a route');
    });

    it('honors a manual exclude list', async () => {
      const r = await paths().get('/subgraph?from=1&to=4&exclude=5');
      assert.deepEqual(r.body.paths.map((p: { nodes: number[] }) => p.nodes), [[1, 2, 3, 4]]);
    });

    it('a successful negative answer: 200 + paths:[] when there is no connection', async () => {
      const r = await paths().get('/subgraph?from=1&to=6'); // F reachable only via the suppressed hub
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.paths, []);
      assert.deepEqual(r.body.suppressedHubs.map((n: { id: number }) => n.id), [7]);
    });

    it('the hop cap can starve an otherwise-reachable target', async () => {
      const r = await paths().get('/subgraph?from=1&to=4&exclude=5&maxHops=2'); // only the 3-hop chain remains
      assert.deepEqual(r.body.paths, []);
    });

    it('status codes: 400 missing, 422 non-integer or self, 404 unknown', async () => {
      const api = paths();
      assert.equal((await api.get('/subgraph?to=4')).status, 400, 'missing from');
      assert.equal((await api.get('/subgraph?from=abc&to=4')).status, 422, 'non-integer');
      assert.equal((await api.get('/subgraph?from=1&to=1')).status, 422, 'from === to');
      assert.equal((await api.get('/subgraph?from=1&to=999')).status, 404, 'unknown entity');
    });
  });

  it('returns 503 when the DB has no graph tables yet', async () => {
    const r = await appWith(empty).get('/Nodes');
    assert.equal(r.status, 503);
  });

  it('returns 503 for search/neighbors/subgraph before the pipeline runs', async () => {
    assert.equal((await appWith(empty).get('/search?q=x')).status, 503);
    assert.equal((await appWith(empty).get('/neighbors/1')).status, 503);
    assert.equal((await appWith(empty).get('/subgraph?from=1&to=2')).status, 503);
  });
});
