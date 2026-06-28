import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from './retry.js';
import { isErrorEnvelope, resolveModelConfig, DEFAULT_MODEL, DEFAULT_EFFORT } from './claude.js';

const always = () => true;

describe('withRetry', () => {
  it('returns the first result without retrying on success', async () => {
    let calls = 0;
    const out = await withRetry(async () => { calls++; return 'ok'; }, { retries: 2, retryable: always });
    assert.equal(out, 'ok');
    assert.equal(calls, 1);
  });

  it('retries a retryable failure then succeeds', async () => {
    let calls = 0;
    const retried: number[] = [];
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('stall');
        return 'recovered';
      },
      { retries: 2, retryable: always, onRetry: (_e, attempt) => retried.push(attempt) },
    );
    assert.equal(out, 'recovered');
    assert.equal(calls, 3);
    assert.deepEqual(retried, [1, 2]);
  });

  it('gives up after exhausting retries and throws the last error', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => { calls++; throw new Error(`fail-${calls}`); }, { retries: 1, retryable: always }),
      /fail-2/,
    );
    assert.equal(calls, 2, '1 initial attempt + 1 retry');
  });

  it('does not retry a non-retryable error', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => { calls++; throw new Error('config'); }, { retries: 3, retryable: () => false }),
      /config/,
    );
    assert.equal(calls, 1);
  });
});

describe('resolveModelConfig', () => {
  it('defaults to opus-4.7/high', () => {
    assert.deepEqual(resolveModelConfig({}), { model: 'claude-opus-4-7', effort: 'high' });
    assert.equal(DEFAULT_MODEL, 'claude-opus-4-7');
    assert.equal(DEFAULT_EFFORT, 'high');
  });

  it('lets the env override model and effort independently', () => {
    assert.deepEqual(resolveModelConfig({ GRAPH_EXTRACT_MODEL: 'sonnet' }), { model: 'sonnet', effort: 'high' });
    assert.deepEqual(resolveModelConfig({ GRAPH_EXTRACT_EFFORT: 'low' }), { model: 'claude-opus-4-7', effort: 'low' });
    assert.deepEqual(
      resolveModelConfig({ GRAPH_EXTRACT_MODEL: 'claude-opus-4-8', GRAPH_EXTRACT_EFFORT: 'medium' }),
      { model: 'claude-opus-4-8', effort: 'medium' },
    );
  });
});

describe('isErrorEnvelope', () => {
  it('flags an is_error envelope (e.g. a mid-stream stall) as retryable', () => {
    assert.equal(isErrorEnvelope({ is_error: true, result: 'Response stalled mid-stream' }), true);
  });

  it('treats a clean envelope as non-error', () => {
    assert.equal(isErrorEnvelope({ is_error: false, structured_output: {} }), false);
    assert.equal(isErrorEnvelope({ structured_output: {} }), false);
    assert.equal(isErrorEnvelope(null), false);
  });
});
