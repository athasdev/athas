// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import Command from "@/ui/command";
import type { LocalHistoryEntry } from "../api/local-history-api";

const history = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    list: vi.fn(),
    read: vi.fn(),
    record: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    readFile: vi.fn(),
    prompt: vi.fn(),
    toasts: [] as string[],
  };
});

vi.mock("../api/local-history-api", () => ({
  listLocalHistoryFile: history.list,
  readLocalHistoryEntry: history.read,
  recordLocalHistoryFile: history.record,
  renameLocalHistoryEntry: history.rename,
  deleteLocalHistoryEntry: history.remove,
}));
vi.mock("../services/restore-local-history", () => ({
  restoreLocalHistorySnapshot: history.restore,
}));
vi.mock("@/features/file-system/api/file-system-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/file-system/api/file-system-api")>()),
  readFile: history.readFile,
}));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showPromptDialog: history.prompt,
}));
vi.mock("sonner", () => {
  const record = (message: string) => history.toasts.push(message);
  return { toast: Object.assign(record, { success: record, error: record, info: record }) };
});

const { LocalHistoryCommandContent } = await import("../components/local-history-command");
const { useBufferStore } = await import("@/features/editor/stores/buffer.store");

enableMapSet();

const entry = (id: string, overrides: Partial<LocalHistoryEntry> = {}): LocalHistoryEntry => ({
  id,
  file_path: "/repo/src/app.ts",
  file_name: "app.ts",
  created_at: Date.parse("2026-10-01T10:00:00Z"),
  size: 2048,
  content_hash: id,
  reason: "save",
  ...overrides,
});

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
const onBack = vi.fn();

async function flush(ms = 0) {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function render(activeFilePath: string | null = "/repo/src/app.ts") {
  await act(async () =>
    root.render(
      <Command isVisible onClose={onClose}>
        <LocalHistoryCommandContent
          isActive
          activeFilePath={activeFilePath}
          onBack={onBack}
          onClose={onClose}
        />
      </Command>,
    ),
  );
  await flush();
}

const body = () => within(document.body);
const rows = () =>
  [...document.querySelectorAll<HTMLElement>('div[role="button"]')].filter((row) =>
    row.textContent?.includes("·"),
  );

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

const rowButton = (row: HTMLElement, name: string) => within(row).getByRole("button", { name });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  for (const fn of Object.values(history)) if (typeof fn === "function") fn.mockReset();
  history.toasts.length = 0;
  onClose.mockReset();
  onBack.mockReset();
  history.list.mockResolvedValue([
    entry("e2", { label: "Before refactor", created_at: Date.parse("2026-10-02T10:00:00Z") }),
    entry("e1", { reason: "external change", size: 512 }),
  ]);
  history.read.mockImplementation(async (path: string, id: string) => `${path} ${id}`);
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("local history timeline", () => {
  it("asks for a file when none is selected", async () => {
    await render(null);
    expect(body().getByText("No local file selected")).toBeTruthy();
    expect(history.list).not.toHaveBeenCalled();
  });

  it("lists snapshots, filters them and goes back", async () => {
    await render();
    expect(body().getByText("Local History: app.ts")).toBeTruthy();
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain("Before refactor");
    expect(rows()[1].textContent).toContain("512 B · external change");
    expect(rows()[0].textContent).toContain("2.0 KB");

    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("Search timeline..."), {
        target: { value: "refactor" },
      });
    });
    expect(rows()).toHaveLength(1);

    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("Search timeline..."), {
        target: { value: "zzz" },
      });
    });
    expect(body().getByText("No local history snapshots")).toBeTruthy();

    await click(body().getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("reports a timeline that cannot be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    history.list.mockRejectedValue(new Error("disk error"));
    await render();
    expect(history.toasts).toContain("Failed to load local history");
    expect(body().getByText("No local history snapshots")).toBeTruthy();
  });

  it("opens a snapshot from the keyboard", async () => {
    await render();
    await act(async () => {
      fireEvent.keyDown(document, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "ArrowUp" });
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Enter" });
    });
    await flush();
    expect(history.read).toHaveBeenCalledWith("/repo/src/app.ts", "e1");
    const buffer = last(useBufferStore.getState().buffers);
    expect(buffer?.path).toBe(`local-history://e1/${encodeURIComponent("/repo/src/app.ts")}`);
    expect(onClose).toHaveBeenCalled();
  });

  it("compares a snapshot with the open buffer and with the previous one", async () => {
    useBufferStore.getState().actions.openBuffer("/repo/src/app.ts", "app.ts", "current text");
    await render();

    await click(rowButton(rows()[0], "Compare with current"));
    const currentDiff = last(useBufferStore.getState().buffers);
    expect(currentDiff?.name).toBe("app.ts: Before refactor vs Current");
    expect(onClose).toHaveBeenCalledTimes(1);

    await click(rowButton(rows()[0], "Compare with previous"));
    expect(last(useBufferStore.getState().buffers)?.name).toMatch(
      /^app\.ts: .+ vs Before refactor$/,
    );

    await click(rowButton(rows()[1], "Compare with previous"));
    expect(history.toasts).toContain("No previous local history entry.");
  });

  it("does not open a diff when the snapshot matches the file", async () => {
    history.readFile.mockResolvedValue("/repo/src/app.ts e1");
    await render();
    await click(rowButton(rows()[1], "Compare with current"));
    expect(history.readFile).toHaveBeenCalledWith("/repo/src/app.ts");
    expect(history.toasts).toContain("No changes to compare.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("creates a named snapshot", async () => {
    history.prompt.mockResolvedValueOnce("  Checkpoint  ");
    history.record.mockResolvedValueOnce(entry("e3", { label: "Checkpoint", reason: "manual" }));
    await render();
    await click(body().getByRole("button", { name: "Create local history entry" }));
    expect(history.record).toHaveBeenCalledWith("/repo/src/app.ts", "manual", "Checkpoint");
    expect(rows()[0].textContent).toContain("Checkpoint");
    expect(history.toasts).toContain("Local history entry created");

    history.prompt.mockResolvedValueOnce("");
    history.record.mockResolvedValueOnce(null);
    await click(body().getByRole("button", { name: "Create local history entry" }));
    expect(history.toasts).toContain("No file changes to snapshot.");
  });

  it("restores, renames and deletes snapshots", async () => {
    history.restore.mockResolvedValueOnce(true);
    await render();
    await click(rowButton(rows()[1], "Restore snapshot"));
    expect(history.restore).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/repo/src/app.ts", entryId: "e1" }),
    );
    expect(history.toasts).toContain("Snapshot restored");
    expect(onClose).toHaveBeenCalled();

    history.rename.mockImplementation(async (path: string, id: string, label: string | null) =>
      entry(id, { label, file_path: path }),
    );
    await click(rowButton(rows()[1], "Rename snapshot"));
    await flush(10);
    const input = body().getByPlaceholderText("Entry name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "Working state" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await flush();
    expect(history.rename).toHaveBeenCalledWith("/repo/src/app.ts", "e1", "Working state");
    expect(rows()[1].textContent).toContain("Working state");

    history.remove.mockResolvedValue(undefined);
    await click(rowButton(rows()[0], "Delete snapshot"));
    expect(rows()).toHaveLength(1);
  });

  it("reports failed snapshot actions", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    history.read.mockRejectedValue(new Error("missing blob"));
    history.restore.mockRejectedValue(new Error("File is read-only"));
    history.remove.mockRejectedValue(new Error("locked"));
    await render();

    await click(rowButton(rows()[0], "Open snapshot"));
    expect(history.toasts).toContain("Failed to open snapshot");
    await click(rowButton(rows()[0], "Compare with current"));
    expect(history.toasts).toContain("Failed to compare snapshot");
    await click(rowButton(rows()[0], "Compare with previous"));
    expect(history.toasts).toContain("Failed to compare snapshots");
    await click(rowButton(rows()[0], "Restore snapshot"));
    expect(history.toasts).toContain("File is read-only");
    await click(rowButton(rows()[0], "Delete snapshot"));
    expect(history.toasts).toContain("Failed to delete snapshot");
    expect(rows()).toHaveLength(2);
  });
});
