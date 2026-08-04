import { createJSONStorage, type PersistStorage, type StateStorage } from "zustand/middleware";

export function createMemoryStateStorage(): StateStorage {
  const storage = new Map<string, string>();

  return {
    getItem: (name) => storage.get(name) ?? null,
    setItem: (name, value) => {
      storage.set(name, value);
    },
    removeItem: (name) => {
      storage.delete(name);
    },
  };
}

const fallbackStateStorage = createMemoryStateStorage();

export function createSafeJSONStorage<State>(): PersistStorage<State> {
  return createJSONStorage<State>(() => {
    try {
      if ("localStorage" in globalThis && globalThis.localStorage) {
        return globalThis.localStorage;
      }
    } catch {
      return fallbackStateStorage;
    }

    return fallbackStateStorage;
  }) as PersistStorage<State>;
}

export function createJSONStorageFrom<State>(storage: StateStorage): PersistStorage<State> {
  return createJSONStorage<State>(() => storage) as PersistStorage<State>;
}
