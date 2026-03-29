import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
  vi,
} from "@voidzero-dev/vite-plus-test";

type CompatVi = typeof vi & {
  doMock: (specifier: string, factory?: unknown) => unknown;
  resetModules: () => void;
  unstubAllGlobals: () => void;
};

const compatVi = vi as CompatVi;

const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
};

if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.clear !== "function"
) {
  compatVi.stubGlobal("localStorage", createMemoryStorage());
}

if (typeof globalThis.window === "object" && globalThis.window) {
  Object.assign(globalThis.window, {
    localStorage: globalThis.localStorage,
  });
}

type MockFactory = typeof vi.fn & {
  module: (specifier: string, factory: () => unknown) => void;
  restore: () => void;
};

const mock = Object.assign(
  (<T extends (...args: any[]) => any>(implementation?: T) =>
    compatVi.fn(implementation)) as typeof vi.fn,
  {
    module: (specifier: string, factory: () => unknown) => {
      compatVi.doMock(specifier, factory as unknown);
    },
    restore: () => {
      compatVi.restoreAllMocks();
      compatVi.resetModules();
      compatVi.unstubAllGlobals();
    },
  },
) as MockFactory;

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  compatVi as vi,
  describe,
  expect,
  it,
  mock,
  test,
};
