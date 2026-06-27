// One headless Claude Code call, shared by every model-backed stage (extraction,
// verification). No Anthropic API SDK, no API key — uses the local `claude` login:
//   claude -p "<prompt>" --output-format json --json-schema <schema> \
//          --append-system-prompt "<instructions>" --model opus
// Returns the envelope's `structured_output`; the caller narrows it to its schema.
// Timeouts, `is_error` envelopes (e.g. "Response stalled mid-stream") and crashes
// are retried once (GRAPH_EXTRACT_RETRIES) before the call is given up on.

import { spawn } from 'node:child_process';
import { recordClaude, TIMING_ENABLED } from './debug/instrument.js';
import { withRetry } from './retry.js';

const MODEL = process.env.GRAPH_EXTRACT_MODEL ?? 'opus';
const EFFORT = process.env.GRAPH_EXTRACT_EFFORT;
const TIMEOUT_MS = Number(process.env.GRAPH_EXTRACT_TIMEOUT_MS ?? 300_000);
const RETRIES = Number(process.env.GRAPH_EXTRACT_RETRIES ?? 1);

export interface ClaudeCall {
  prompt: string;
  schema: object;
  systemPrompt: string;
  label?: string;
}

export class RetryableClaudeError extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function isErrorEnvelope(envelope: any): boolean {
  return envelope?.is_error === true;
}

function envelopeError(envelope: any): string {
  return String(envelope?.result ?? envelope?.subtype ?? 'unknown error').slice(0, 300);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function runClaude(call: ClaudeCall): Promise<unknown> {
  return withRetry(() => runClaudeOnce(call), {
    retries: RETRIES,
    retryable: (err) => err instanceof RetryableClaudeError,
    onRetry: (err, attempt) =>
      console.warn(`claude ${call.label ?? ''} attempt ${attempt} failed (${message(err)}); retrying…`),
  });
}

function runClaudeOnce(call: ClaudeCall): Promise<unknown> {
  const args = [
    '-p',
    call.prompt,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(call.schema),
    '--append-system-prompt',
    call.systemPrompt,
    '--model',
    MODEL,
    ...(EFFORT ? ['--effort', EFFORT] : []),
  ];

  return new Promise((resolve, reject) => {
    const wallStart = performance.now();
    const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = '';
    let err = '';
    let done = false;
    const settle = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      settle(() => reject(new RetryableClaudeError(`claude call timed out after ${TIMEOUT_MS}ms`)));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e) =>
      settle(() => reject(new Error(`failed to spawn claude (is the CLI installed/on PATH?): ${e.message}`))),
    );
    proc.on('close', (code) =>
      settle(() => {
        let envelope: { structured_output?: unknown };
        try {
          envelope = JSON.parse(out);
        } catch (e) {
          return reject(
            code === 0
              ? new Error(`could not parse claude JSON output: ${(e as Error).message}`)
              : new RetryableClaudeError(`claude exited ${code}: ${(err || out).slice(0, 600)}`),
          );
        }
        if (TIMING_ENABLED) recordClaudeEnvelope(call.label ?? 'claude', performance.now() - wallStart, envelope);
        if (isErrorEnvelope(envelope)) {
          return reject(new RetryableClaudeError(`claude reported is_error: ${envelopeError(envelope)}`));
        }
        if (code !== 0) {
          return reject(new RetryableClaudeError(`claude exited ${code}: ${(err || out).slice(0, 600)}`));
        }
        if (envelope.structured_output === undefined) {
          return reject(new Error('claude returned no structured_output matching the schema'));
        }
        resolve(envelope.structured_output);
      }),
    );
  });
}

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 120);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function recordClaudeEnvelope(label: string, wallMs: number, envelope: any): void {
  const u = envelope?.usage ?? {};
  recordClaude({
    label,
    wallMs,
    durationMs: envelope?.duration_ms,
    durationApiMs: envelope?.duration_api_ms,
    ttftMs: envelope?.ttft_ms,
    timeToRequestMs: envelope?.time_to_request_ms,
    numTurns: envelope?.num_turns,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheCreationTokens: u.cache_creation_input_tokens,
    cacheReadTokens: u.cache_read_input_tokens,
    costUsd: envelope?.total_cost_usd,
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
