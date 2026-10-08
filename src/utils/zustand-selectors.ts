import type { StoreApi, UseBoundStore } from "zustand";

type StateSelectors<T> = { readonly [K in keyof T]-?: () => T[K] };

export type WithSelectors<S> = S extends { getState: () => infer T }
  ? S & { use: StateSelectors<T> }
  : never;

// Names that promise, serialization, and React checks probe on any object; `store.use` must not
// answer them with a hook, or it looks thenable, serializable, or like a React element.
const RESERVED_KEYS = new Set(["then", "toJSON", "$$typeof", "constructor", "prototype"]);

/**
 * Adds `store.use.key()`, a hook selecting one top-level state key. Every key has a hook — optional
 * keys and keys missing from the initial state included — so a call is never conditional.
 */
export const createSelectors = <S extends UseBoundStore<StoreApi<object>>>(_store: S) => {
  const store = _store as WithSelectors<typeof _store>;
  const hooks = new Map<string, () => unknown>();

  store.use = new Proxy({} as WithSelectors<typeof _store>["use"], {
    get: (_target, key) => {
      if (typeof key !== "string" || RESERVED_KEYS.has(key)) return undefined;
      let hook = hooks.get(key);
      if (!hook) {
        hook = () => store((state) => (state as Record<string, unknown>)[key]);
        hooks.set(key, hook);
      }
      return hook;
    },
  });

  return store;
};
