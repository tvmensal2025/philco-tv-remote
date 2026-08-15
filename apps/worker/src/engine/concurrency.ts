export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}

export function createCircuit(input: { failureThreshold: number; resetMs: number }) {
  let failures = 0;
  let openUntil = 0;
  return {
    allow() {
      return Date.now() >= openUntil;
    },
    success() {
      failures = 0;
    },
    failure() {
      failures += 1;
      if (failures >= input.failureThreshold) openUntil = Date.now() + input.resetMs;
    },
  };
}
