/**
 * Tiny localStorage wrapper (task 6.1, reused by 6.2's settings).
 *
 * localStorage can be missing (non-browser), throw (private mode, blocked
 * site data, quota) or hold garbage from an older build, so every access is
 * guarded: loads validate and fall back to `null`, saves report success. The
 * `Storage` is injectable so this is unit-testable under node.
 */

/** The subset of the Web Storage API used here. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `window.localStorage` if it exists and is reachable, else `null`. */
export function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Read and validate a JSON value. Returns `null` when the store is missing,
 * the key is absent, the JSON is malformed, reading throws, or `validate`
 * rejects it (returns `null`).
 */
export function loadJSON<T>(
  store: KeyValueStore | null,
  key: string,
  validate: (raw: unknown) => T | null,
): T | null {
  if (!store) return null;
  try {
    const text = store.getItem(key);
    if (text === null) return null;
    return validate(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Write a JSON value; `false` if there's no store or writing throws. */
export function saveJSON(store: KeyValueStore | null, key: string, value: unknown): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Remove a key; never throws. */
export function removeKey(store: KeyValueStore | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // ignore
  }
}

/** In-memory store (tests, and a fallback when localStorage is unavailable). */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
