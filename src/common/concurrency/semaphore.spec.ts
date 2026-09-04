import { Semaphore } from './semaphore';

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('Semaphore', () => {
  it('never runs more than the configured number of tasks at once', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;

    const task = () =>
      semaphore.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await tick();
        running--;
      });

    await Promise.all([task(), task(), task(), task(), task()]);

    expect(peak).toBe(2);
    expect(semaphore.inFlight).toBe(0);
  });

  it('makes the excess wait instead of dropping it', async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];

    const first = semaphore.run(async () => {
      order.push(1);
      await tick();
    });
    const second = semaphore.run(async () => {
      order.push(2);
    });

    expect(semaphore.queued).toBe(1);
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it('releases the permit even when the task throws', async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(semaphore.inFlight).toBe(0);
    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects a nonsensical permit count rather than deadlocking later', () => {
    expect(() => new Semaphore(0)).toThrow(/at least one permit/);
  });
});
