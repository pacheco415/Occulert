export interface ClosedSample {
  at: number;
  closed: boolean;
}

/**
 * Tracks the closed-eye fraction of a rolling time window in amortized O(1).
 *
 * The previous scoring path rebuilt and rescanned the full sample array for
 * every camera result. Keeping a head index and closed count avoids that
 * repeated allocation on the monitoring hot path while preserving the exact
 * window boundary behavior.
 */
export class RollingClosedFraction {
  private samples: ClosedSample[] = [];
  private head = 0;
  private closedCount = 0;
  private readonly windowMs: number;

  constructor(windowMs: number) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError('windowMs must be a positive finite number');
    }
    this.windowMs = windowMs;
  }

  add(at: number, closed: boolean): number {
    this.samples.push({ at, closed });
    if (closed) this.closedCount += 1;
    this.prune(at);

    const count = this.samples.length - this.head;
    return count > 0 ? this.closedCount / count : 0;
  }

  reset(): void {
    this.samples = [];
    this.head = 0;
    this.closedCount = 0;
  }

  get sampleCount(): number {
    return this.samples.length - this.head;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.head < this.samples.length && this.samples[this.head].at <= cutoff) {
      if (this.samples[this.head].closed) this.closedCount -= 1;
      this.head += 1;
    }

    // Compact occasionally so expired entries never accumulate during a long
    // drive, without allocating a replacement array for every camera sample.
    if (this.head >= 256 && this.head * 2 >= this.samples.length) {
      this.samples = this.samples.slice(this.head);
      this.head = 0;
    }
  }
}
