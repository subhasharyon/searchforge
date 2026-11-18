/**
 * In-process queue primitives for the MVP crawler. No external broker -
 * a bounded worker pool plus a per-domain scheduler.
 */

export const abortError = (): DOMException =>
  new DOMException("Crawl aborted", "AbortError");

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Minimum spacing between requests to the same hostname. Reservation-based:
 * concurrent workers each claim the next slot, so requests are spaced even
 * when several workers hit the same domain simultaneously.
 */
export class DomainThrottle {
  private readonly nextAllowed = new Map<string, number>();

  constructor(private readonly delayMs: number) {}

  async wait(host: string, signal?: AbortSignal): Promise<void> {
    if (this.delayMs <= 0) {
      if (signal?.aborted) {
        throw abortError();
      }
      return;
    }
    const now = Date.now();
    const at = Math.max(now, this.nextAllowed.get(host) ?? 0);
    this.nextAllowed.set(host, at + this.delayMs);
    const waitMs = at - now;
    if (waitMs > 0) {
      await sleep(waitMs, signal);
    }
  }
}

/**
 * Bounded-concurrency runner. Stops scheduling new work as soon as the
 * abort signal fires; in-flight work finishes (or aborts via the same
 * signal). Item handlers are expected to contain their own error handling.
 */
export const runWorkerPool = async <T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  opts: { concurrency: number; signal?: AbortSignal }
): Promise<void> => {
  let index = 0;
  const next = async (): Promise<void> => {
    while (!opts.signal?.aborted) {
      const i = index;
      index += 1;
      if (i >= items.length) {
        return;
      }
      await worker(items[i] as T);
    }
  };

  const workerCount = Math.max(1, Math.min(opts.concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, next));
};
