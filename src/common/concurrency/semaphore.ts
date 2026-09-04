/**
 * Q61 — backpressure, in its smallest possible form.
 *
 * A consumer that starts work for every message it receives has no upper bound
 * on memory or on the load it puts on downstream systems: if the producer is
 * faster than the worker, the only thing that stops it is the process dying.
 * A semaphore turns "process everything at once" into "process N at a time and
 * make the rest wait", which is what pushes the pressure back to the queue
 * where it can be seen and measured.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly permits: number) {
    if (permits < 1) throw new Error('Semaphore needs at least one permit');
    this.available = permits;
  }

  get inFlight(): number {
    return this.permits - this.available;
  }

  get queued(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the permit straight to the next waiter rather than bouncing it
      // through `available`, so a permit can never be lost between the two.
      next();
      return;
    }
    if (this.available < this.permits) this.available++;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
