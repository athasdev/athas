import { vi } from "vite-plus/test";

// Define global localStorage mock
const createMockStorage = () => {
  const storage = new Map<string, string>();
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
};

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = createMockStorage() as any;
}

if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    localStorage: globalThis.localStorage,
    setTimeout: (callback: any) => {
      callback();
      return 0 as any;
    },
  } as any;
}

if (typeof globalThis.document === "undefined") {
  const styleHost = { appendChild: vi.fn() };
  globalThis.document = {
    activeElement: null,
    createElement: vi.fn((tagName: string) => {
      const base = {
        setAttribute: vi.fn(),
        appendChild: vi.fn(),
        style: {},
        getBoundingClientRect: vi.fn(() => ({ width: 100 })),
        textContent: "",
      };
      if (tagName === "canvas") {
        return {
          ...base,
          getContext: vi.fn(() => ({
            measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
            font: "",
          })),
        } as any;
      }
      return base as any;
    }),
    createTextNode: vi.fn((text: string) => ({ textContent: text })),
    getElementsByTagName: vi.fn((tagName: string) => (tagName === "head" ? [styleHost] : [])),
  } as any;
}

// Mock Tauri Core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
  convertFileSrc: vi.fn((path) => path),
}));

// Mock Webview Window
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn().mockReturnValue({ label: "main" }),
  getAllWebviewWindows: vi.fn().mockResolvedValue([{ label: "main" }]),
}));

// Mock Window
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    label: "main",
    listen: vi.fn().mockResolvedValue(() => {}),
  }),
}));

// Mock Events
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Mock App
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.7.0"),
  getName: vi.fn().mockResolvedValue("athas"),
}));

// Mock Dialog Plugin
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn().mockResolvedValue("/mock/path"),
  open: vi.fn().mockResolvedValue("/mock/path"),
  ask: vi.fn().mockResolvedValue(true),
  message: vi.fn().mockResolvedValue(undefined),
}));

// Mock FS Plugin
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue(""),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
}));

// Mock Process Plugin
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
  exit: vi.fn().mockResolvedValue(undefined),
}));

// Mock Shell Plugin
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
  Command: vi.fn(),
}));

// Mock Store Plugin
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock Updater Plugin
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

// Mock Opener Plugin
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

// Mock Clipboard Manager Plugin
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue(""),
}));
