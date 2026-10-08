import type { PersistStorage, StorageValue } from "zustand/middleware";

function haveSameEntries(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  for (const key of keys) {
    if (!Object.is(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

/**
 * `persist` writes its partialized state on every `set`, so a store that persists a few
 * preferences next to fast-changing state (a streamed reply updates once per frame) rewrote
 * storage every frame. This passes a write through only when the persisted values differ from the
 * last ones read or written.
 */
export function skipUnchangedPersistWrites<State>(
  storage: PersistStorage<State> | undefined,
): PersistStorage<State> | undefined {
  if (!storage) return storage;
  const lastValues = new Map<string, StorageValue<State>>();

  const remember = (name: string, value: StorageValue<State> | null) => {
    if (value) lastValues.set(name, value);
    else lastValues.delete(name);
    return value;
  };

  return {
    getItem: (name) => {
      const value = storage.getItem(name);
      return value instanceof Promise
        ? value.then((resolved) => remember(name, resolved))
        : remember(name, value);
    },
    setItem: (name, value) => {
      const last = lastValues.get(name);
      if (last && last.version === value.version && haveSameEntries(last.state, value.state)) {
        return;
      }
      lastValues.set(name, value);
      return storage.setItem(name, value);
    },
    removeItem: (name) => {
      lastValues.delete(name);
      return storage.removeItem(name);
    },
  };
}
