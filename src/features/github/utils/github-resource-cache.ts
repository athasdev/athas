export interface CacheEntry<T> {
  fetchedAt: number;
  value: T;
}

export interface TimedResourceCache<T> {
  getSnapshot: (key: string) => CacheEntry<T> | undefined;
  getFreshValue: (key: string, ttlMs: number) => T | null;
  set: (key: string, value: T) => T;
  load: (
    key: string,
    loader: () => Promise<T>,
    options?: { force?: boolean; ttlMs?: number },
  ) => Promise<T>;
  clear: (key?: string) => void;
}

export function createTimedResourceCache<T>(): TimedResourceCache<T> {
  const entries = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, Promise<T>>();

  return {
    getSnapshot: (key) => entries.get(key),

    getFreshValue: (key, ttlMs) => {
      const entry = entries.get(key);
      if (!entry) return null;
      return Date.now() - entry.fetchedAt < ttlMs ? entry.value : null;
    },

    set: (key, value) => {
      entries.set(key, { fetchedAt: Date.now(), value });
      return value;
    },

    load: async (key, loader, options) => {
      const force = options?.force ?? false;
      const ttlMs = options?.ttlMs ?? 0;

      if (!force && ttlMs > 0) {
        const freshValue = entries.get(key);
        if (freshValue && Date.now() - freshValue.fetchedAt < ttlMs) {
          return freshValue.value;
        }
      }

      const existingRequest = inFlight.get(key);
      if (existingRequest) {
        return existingRequest;
      }

      const request = loader()
        .then((value) => {
          entries.set(key, { fetchedAt: Date.now(), value });
          return value;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, request);
      return request;
    },

    clear: (key) => {
      if (key) {
        entries.delete(key);
        inFlight.delete(key);
        return;
      }

      entries.clear();
      inFlight.clear();
    },
  };
}
