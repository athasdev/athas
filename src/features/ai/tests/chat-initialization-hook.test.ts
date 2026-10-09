// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  migrate: vi.fn(),
  initializeDatabase: vi.fn(),
  loadChatsFromDatabase: vi.fn(),
}));

vi.mock("../lib/chat-migration", () => ({ performMigrationIfNeeded: mocks.migrate }));
vi.mock("../stores/ai-chat.store", () => ({
  useAIChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      actions: {
        initializeDatabase: mocks.initializeDatabase,
        loadChatsFromDatabase: mocks.loadChatsFromDatabase,
      },
    }),
}));

import { useChatInitialization } from "../hooks/use-chat-initialization";

type Init = ReturnType<typeof useChatInitialization>;
let root: Root;
let init: Init;
const steps: string[] = [];

function Harness() {
  init = useChatInitialization();
  return null;
}

async function mount() {
  await act(async () => root.render(createElement(Harness)));
  await act(async () => {});
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  steps.length = 0;
  mocks.initializeDatabase.mockImplementation(async () => steps.push("init"));
  mocks.migrate.mockImplementation(async () => {
    steps.push("migrate");
    return true;
  });
  mocks.loadChatsFromDatabase.mockImplementation(async () => steps.push("load"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("useChatInitialization", () => {
  it("opens the database, migrates and loads chats in order", async () => {
    await mount();
    expect(steps).toEqual(["init", "migrate", "load"]);
    expect(init).toEqual({ isInitialized: true, isLoading: false, error: null });
  });

  it("keeps going when the legacy migration fails", async () => {
    mocks.migrate.mockResolvedValue(false);
    await mount();
    expect(console.warn).toHaveBeenCalledWith(
      "Migration failed, but continuing with initialization",
    );
    expect(mocks.loadChatsFromDatabase).toHaveBeenCalled();
    expect(init.isInitialized).toBe(true);
  });

  it("reports a storage failure", async () => {
    mocks.loadChatsFromDatabase.mockRejectedValue(new Error("database disk image is malformed"));
    await mount();
    expect(init).toEqual({
      isInitialized: false,
      isLoading: false,
      error: "Failed to initialize chat storage: Error: database disk image is malformed",
    });
  });

  it("does not update state after unmounting", async () => {
    let finish: () => void = () => {};
    mocks.loadChatsFromDatabase.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    await act(async () => root.render(createElement(Harness)));
    expect(init.isLoading).toBe(true);
    await act(async () => root.unmount());
    await act(async () => finish());
    expect(init.isInitialized).toBe(false);
    root = createRoot(document.createElement("div"));
  });
});
