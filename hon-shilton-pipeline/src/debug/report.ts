// Shared pretty-printers for the debug timing collectors. Used by both
// debug-ingest.ts and debug-verify.ts so the two stages report in one format.

import type { Sample, ClaudeSample } from './instrument.js';

interface Stat {
  step: string;
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  total: number;
}

function statsFor(samples: Sample[]): Stat[] {
  const byStep = new Map<string, number[]>();
  for (const s of samples) {
    const arr = byStep.get(s.step) ?? [];
    arr.push(s.ms);
    byStep.set(s.step, arr);
  }
  return [...byStep.entries()].map(([step, xs]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return {
      step,
      count: xs.length,
      mean: avg(xs),
      median: sorted[Math.floor((sorted.length - 1) / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      total: xs.reduce((a, b) => a + b, 0),
    };
  });
}

export function printStepTable(samples: Sample[], order: string[], wallTotalMs: number): void {
  const stats = statsFor(samples).sort((a, b) => rank(a.step, order) - rank(b.step, order));
  const grandTotal = stats.reduce((a, s) => a + s.total, 0);

  console.log('\n================ SUB-STEP TIMINGS (ms) ================');
  console.log(pad('step', 12) + col('count') + col('mean') + col('median') + col('min') + col('max') + col('total') + col('%steps'));
  for (const s of stats) {
    console.log(
      pad(s.step, 12) +
        col(s.count) +
        col(fmt(s.mean)) +
        col(fmt(s.median)) +
        col(fmt(s.min)) +
        col(fmt(s.max)) +
        col(fmt(s.total)) +
        col(pct(s.total, grandTotal)),
    );
  }
  console.log('-'.repeat(82));
  console.log(`measured sub-step total: ${sec(grandTotal)}   |   end-to-end wall: ${sec(wallTotalMs)}`);
}

export function printClaudeBreakdown(claude: ClaudeSample[]): void {
  if (!claude.length) return;
  const byLabel = new Map<string, ClaudeSample[]>();
  for (const c of claude) {
    const arr = byLabel.get(c.label) ?? [];
    arr.push(c);
    byLabel.set(c.label, arr);
  }

  console.log('\n========== CLAUDE CALL BREAKDOWN (mean per call, ms) ==========');
  console.log(
    pad('label', 10) +
      col('n') +
      col('wall') +
      col('startup') +
      col('agent') +
      col('api') +
      col('ttft') +
      col('toReq') +
      col('inTok') +
      col('outTok') +
      col('cacheCr') +
      col('$/call'),
  );
  for (const [label, cs] of byLabel) {
    const startup = cs.map((c) => c.wallMs - (c.durationMs ?? c.wallMs));
    console.log(
      pad(label, 10) +
        col(cs.length) +
        col(fmt(avg(cs.map((c) => c.wallMs)))) +
        col(fmt(avg(startup))) +
        col(fmt(avg(cs.map((c) => c.durationMs ?? 0)))) +
        col(fmt(avg(cs.map((c) => c.durationApiMs ?? 0)))) +
        col(fmt(avg(cs.map((c) => c.ttftMs ?? 0)))) +
        col(fmt(avg(cs.map((c) => c.timeToRequestMs ?? 0)))) +
        col(Math.round(avg(cs.map((c) => c.inputTokens ?? 0)))) +
        col(Math.round(avg(cs.map((c) => c.outputTokens ?? 0)))) +
        col(Math.round(avg(cs.map((c) => c.cacheCreationTokens ?? 0)))) +
        col(avg(cs.map((c) => c.costUsd ?? 0)).toFixed(3)),
    );
  }
  console.log('startup = wall − agent(duration_ms): CLI boot + system-prompt/tool cache creation before the model runs.');
}

const rank = (step: string, order: string[]): number => {
  const i = order.indexOf(step);
  return i === -1 ? order.length : i;
};
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (ms: number): string => Math.round(ms).toLocaleString();
const sec = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const pct = (part: number, whole: number): string => (whole ? `${((100 * part) / whole).toFixed(0)}%` : '-');
const pad = (s: string, n: number): string => s.padEnd(n);
const col = (s: string | number): string => String(s).padStart(9);
