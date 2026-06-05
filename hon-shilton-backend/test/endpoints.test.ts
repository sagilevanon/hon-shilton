import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { getNodes, getEdges } from '../server/endpoints.js';
import { initStore } from '../server/graphStore.js';

// Minimal subset of the pipeline's schema — enough for the read queries.
function buildPopulatedDb(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE entities (id INTEGER PRIMARY KEY AUTOINCREMENT, qid TEXT, canonical_name TEXT NOT NULL,
      type TEXT NOT NULL, subtype TEXT, description TEXT, image TEXT) STRICT;
    CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, src_entity_id INTEGER, tgt_entity_id INTEGER,
      relation TEXT, category TEXT, confidence TEXT, status TEXT DEFAULT 'proposed', directed INTEGER DEFAULT 1) STRICT;
    CREATE TABLE edge_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, edge_id INTEGER, url TEXT, outlet TEXT,
      published_date TEXT, quote TEXT) STRICT;
  `);
  db.prepare("INSERT INTO entities (canonical_name, type) VALUES ('בנימין נתניהו', 'person')").run();
  db.prepare("INSERT INTO entities (canonical_name, type, subtype) VALUES ('הליכוד', 'organization', 'political_party')").run();
  db.prepare("INSERT INTO edges (src_entity_id, tgt_entity_id, relation, category, confidence) VALUES (1, 2, 'חבר ב', 'פוליטי', 'high')").run();
  db.prepare("INSERT INTO edge_sources (edge_id, url, outlet, quote) VALUES (1, 'http://x', 'ynet', 'q')").run();
  db.close();
}

describe('read API (SQLite-backed)', () => {
  let tmp: string;
  let populated: string;
  let empty: string;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'honshilton-'));
    populated = path.join(tmp, 'graph.db');
    empty = path.join(tmp, 'empty.db');
    buildPopulatedDb(populated);
    new DatabaseSync(empty).close(); // exists, but has no graph tables
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function appWith(dbPath: string): ReturnType<typeof supertest> {
    initStore(dbPath);
    const app = express();
    app.get('/Nodes', getNodes);
    app.get('/Edges', getEdges);
    return supertest(app);
  }

  it('serves nodes from the DB in display shape', async () => {
    const r = await appWith(populated).get('/Nodes');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 2);
    assert.ok('id' in r.body[0] && 'name' in r.body[0] && 'group' in r.body[0]);
  });

  it('serves edges with corroboration count and provenance', async () => {
    const r = await appWith(populated).get('/Edges');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 1);
    const e = r.body[0];
    assert.ok('source' in e && 'target' in e);
    assert.equal(e.value, 1); // corroboration = number of sources
    assert.ok(Array.isArray(e.sources) && e.sources[0].quote === 'q');
  });

  it('returns 503 when the DB has no graph tables yet', async () => {
    const r = await appWith(empty).get('/Nodes');
    assert.equal(r.status, 503);
  });
});
