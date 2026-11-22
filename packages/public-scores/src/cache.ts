type CacheEntry<T> = { expires: number; value: T };

const store = new Map<string, CacheEntry<unknown>>();
const TTL_MS = 60_000;

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = TTL_MS): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
