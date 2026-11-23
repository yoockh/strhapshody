/**
 * A tiny least-recently-used cache (used for rendered pluck buffers, task 7.2
 * follow-up). Pure, generic, unit-tested. `get` refreshes recency; `set`
 * evicts the least recently used entry once `capacity` is exceeded.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(Number.isFinite(capacity) ? capacity : 1));
  }

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v); // most recent at the end
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
