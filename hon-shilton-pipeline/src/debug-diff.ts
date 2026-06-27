// Phase-C diff CLI: compare a candidate graph DB against the baseline (existing
// records) and report entity/edge add/drop/change counts, with the article url
// + quote attached to every divergent edge so it can be judged, not just tallied.
//
//   npm run debug-diff -- --base ../hon-shilton-backend/server/graph.db \
//                         --candidate /tmp/cand-sonnet.db

import { openDb, getGraph } from './db.js';
import { diffGraphs, type EdgeRef, type EdgeChange } from './debug/diff.js';
import { parseCli } from './cli-args.js';

function main(): void {
  const { values } = parseCli();
  const candidate = values.candidate ?? values.db;
  if (!values.base || !candidate) {
    console.error('Usage: npm run debug-diff -- --base <baseline.db> --candidate <candidate.db>');
    process.exit(1);
  }

  const base = getGraph(openDb(values.base));
  const cand = getGraph(openDb(candidate));
  const diff = diffGraphs(base, cand, {
    normalizeKeys: values.normalize ?? false,
    gazetteerKeys: values.gazetteer ?? false,
  });

  console.log(`baseline:  ${values.base}  (${base.nodes.length} entities, ${base.edges.length} edges)`);
  console.log(`candidate: ${candidate}  (${cand.nodes.length} entities, ${cand.edges.length} edges)`);
  console.log(`keys: ${values.gazetteer ? 'GAZETTEER' : values.normalize ? 'NORMALIZED' : 'raw'}\n`);

  console.log('================ ENTITIES ================');
  console.log(`common: ${diff.entities.common}  dropped: ${diff.entities.onlyBase.length}  added: ${diff.entities.onlyCandidate.length}`);
  if (diff.entities.onlyBase.length) console.log(`  only in baseline:  ${diff.entities.onlyBase.join(', ')}`);
  if (diff.entities.onlyCandidate.length) console.log(`  only in candidate: ${diff.entities.onlyCandidate.join(', ')}`);

  console.log('\n================ EDGES ================');
  console.log(
    `common: ${diff.edges.common}  dropped: ${diff.edges.dropped.length}  ` +
      `added: ${diff.edges.added.length}  changed: ${diff.edges.changed.length}`,
  );
  printEdges('DROPPED (in baseline, not candidate)', diff.edges.dropped);
  printEdges('ADDED (in candidate, not baseline)', diff.edges.added);
  printChanges(diff.edges.changed);
}

function printEdges(heading: string, edges: EdgeRef[]): void {
  if (!edges.length) return;
  console.log(`\n-- ${heading} --`);
  for (const e of edges) {
    console.log(`  ${e.source} → ${e.target}  [${e.relation}]`);
    if (e.url) console.log(`     ${e.url}`);
    if (e.quote) console.log(`     “${e.quote}”`);
  }
}

function printChanges(changes: EdgeChange[]): void {
  if (!changes.length) return;
  console.log('\n-- CHANGED (same edge, different attribute) --');
  for (const c of changes) {
    console.log(`  ${c.source} → ${c.target} [${c.relation}]  ${c.field}: ${c.base} → ${c.candidate}`);
  }
}

main();
