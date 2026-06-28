import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapPool, Semaphore } from './pool.js';
import { sleep } from './sleep.js';

describe('mapPool', () => {
  it('preserves input order in the results regardless of completion order', async () => {
    const out = await mapPool([10, 1, 5], 3, async (ms, i) => {
      await sleep(ms);
      return i;
    });
    assert.deepEqual(out, [0, 1, 2]);
  });

  it('never runs more than `concurrency` workers at once', async () => {
    let active = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(5);
      active--;
    });
    assert.equal(peak, 4, 'peak concurrency is capped at 4');
  });

  it('runs every item even when concurrency exceeds the item count', async () => {
    const seen: number[] = [];
    await mapPool([1, 2, 3], 10, async (x) => void seen.push(x));
    assert.deepEqual(seen.sort(), [1, 2, 3]);
  });

  it('propagates a worker rejection', async () => {
    await assert.rejects(
      mapPool([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('boom');
        return x;
      }),
      /boom/,
    );
  });

  it('handles an empty input', async () => {
    assert.deepEqual(await mapPool([], 5, async (x) => x), []);
  });
});

describe('Semaphore', () => {
  it('bounds the number of concurrent holders', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        sem.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await sleep(5);
          active--;
        }),
      ),
    );
    assert.equal(peak, 2);
  });

  it('releases the slot even when the task throws', async () => {
    const sem = new Semaphore(1);
    await assert.rejects(sem.run(async () => { throw new Error('x'); }), /x/);
    assert.equal(await sem.run(async () => 'ok'), 'ok', 'slot is reusable after a failure');
  });
});
