import { describe, expect, it } from 'vitest';
import { Semaphore, createCircuit } from './concurrency.js';

describe('semaphore', () => {
  it('caps overlapping work', async () => {
    const lock = new Semaphore(1);
    let peak = 0;
    let current = 0;
    await Promise.all(
      [1, 2, 3].map(() =>
        lock.run(async () => {
          current += 1;
          peak = Math.max(peak, current);
          await new Promise((resolve) => setTimeout(resolve, 10));
          current -= 1;
        }),
      ),
    );
    expect(peak).toBe(1);
  });
});

describe('circuit', () => {
  it('opens after consecutive failures', () => {
    const circuit = createCircuit({ failureThreshold: 2, resetMs: 60_000 });
    expect(circuit.allow()).toBe(true);
    circuit.failure();
    expect(circuit.allow()).toBe(true);
    circuit.failure();
    expect(circuit.allow()).toBe(false);
  });
});
