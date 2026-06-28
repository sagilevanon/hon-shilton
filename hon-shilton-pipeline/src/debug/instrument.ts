// Env-gated timing instrumentation for the ingestion pipeline. When
// GRAPH_DEBUG_TIMING is unset, every export here is a cheap no-op, so the real
// code paths in claude.ts / ynet.ts / pipeline.ts / feed.ts are untouched in
// production. When set, record()/recordClaude() collect samples that the debug
// entry point (debug-ingest.ts) prints as a per-sub-step table.

export const TIMING_ENABLED = /^(1|true|on|yes)$/i.test(process.env.GRAPH_DEBUG_TIMING ?? '');

export interface Sample {
  step: string;
  ms: number;
}

export interface ClaudeSample {
  label: string;
  wallMs: number;
  durationMs?: number;
  durationApiMs?: number;
  ttftMs?: number;
  timeToRequestMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

const samples: Sample[] = [];
const claudeSamples: ClaudeSample[] = [];

export function record(step: string, ms: number): void {
  if (TIMING_ENABLED) samples.push({ step, ms });
}

// Time a synchronous or async thunk and record it under `step`.
export async function timed<T>(step: string, fn: () => Promise<T> | T): Promise<T> {
  if (!TIMING_ENABLED) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(step, performance.now() - start);
  }
}

export function recordClaude(sample: ClaudeSample): void {
  if (TIMING_ENABLED) claudeSamples.push(sample);
}

export function getSamples(): Sample[] {
  return samples;
}

export function getClaudeSamples(): ClaudeSample[] {
  return claudeSamples;
}

export function clearTiming(): void {
  samples.length = 0;
  claudeSamples.length = 0;
}
