// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/stores/buffer-index";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import type { ToastInput } from "@/utils/toast";
import {
  cleanupFileWatcherListener,
  handleFileChange,
  initializeFileWatcherListener,
} from "../services/file-watcher-listener";

const disk = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    files: new Map<string, string>(),
    gate: null as Promise<void> | null,
    toasts: [] as ToastInput[],
    listeners: new Map<string, (event: { payload: unknown }) => unknown>(),
    unlistened: [] as string[],
    failUnlisten: false,
  };
});

vi.mock("../api/file-operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/file-operations")>()),
  readFileContent: async (path: string) => {
    if (disk.gate) await disk.gate;
    const content = disk.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  },
}));
vi.mock("@/utils/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/toast")>()),
  showToast: (toast: ToastInput) => {
    disk.toasts.push(toast);
    return "toast";
  },
}));
vi.mock("@tauri-apps/api/event", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/event")>()),
  listen: async (name: string, listener: (event: { payload: unknown }) => unknown) => {
    disk.listeners.set(name, listener);
    return () => {
      disk.unlistened.push(name);
      if (disk.failUnlisten) throw new Error("listener already removed");
    };
  },
}));

enableMapSet();

const path = "/repo/notes.md";
const buffer = () => getBufferByPath(useBufferStore.getState().buffers, path);
const text = () => {
  const current = buffer();
  return current?.type === "editor" ? current.content : undefined;
};

function openDirty(content: string) {
  const id = useBufferStore.getState().actions.openContent({
    type: "editor",
    path,
    name: "notes.md",
    content: "original",
  });
  useBufferStore.getState().actions.updateBufferContent(id, content, true);
  return id;
}

function holdDiskReads() {
  let release: () => void = () => undefined;
  disk.gate = new Promise<void>((resolve) => (release = resolve));
  return () => {
    disk.gate = null;
    release();
  };
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  disk.files.clear();
  disk.gate = null;
  disk.toasts = [];
  disk.listeners.clear();
  disk.unlistened = [];
  disk.failUnlisten = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  disk.failUnlisten = false;
  await cleanupFileWatcherListener();
  vi.restoreAllMocks();
});

describe("external changes to files with unsaved edits", () => {
  it("keeps the edits quietly when the changed file cannot be read", async () => {
    openDirty("my edits");

    await handleFileChange({ path, event_type: "reloaded" });

    expect(text()).toBe("my edits");
    const current = buffer();
    expect(current?.type === "editor" && current.isDirty).toBe(true);
    expect(disk.toasts).toEqual([]);
  });

  it("reloads from disk when the user saved while the disk was being read", async () => {
    const id = openDirty("my edits");
    disk.files.set(path, "written by an agent");
    const release = holdDiskReads();

    const change = handleFileChange({ path, event_type: "reloaded" });
    useBufferStore.getState().actions.markBufferDirty(id, false);
    release();
    await change;

    expect(text()).toBe("written by an agent");
    expect(disk.toasts).toEqual([]);
  });

  it("does nothing when the file was closed while the disk was being read", async () => {
    const id = openDirty("my edits");
    disk.files.set(path, "changed");
    const release = holdDiskReads();

    const change = handleFileChange({ path, event_type: "reloaded" });
    useBufferStore.getState().actions.closeBufferForce(id);
    release();
    await change;

    expect(buffer()).toBeNull();
    expect(disk.toasts).toEqual([]);
  });

  it("offers a reload that replaces the edits with the disk contents", async () => {
    openDirty("my edits");
    disk.files.set(path, "from disk");

    await handleFileChange({ path, event_type: "reloaded" });
    expect(disk.toasts[0]).toMatchObject({ message: "notes.md changed on disk", type: "warning" });

    disk.toasts[0].action?.onClick();
    await vi.waitFor(() => expect(text()).toBe("from disk"));
  });
});

describe("file watcher listener", () => {
  it("applies change events from the backend", async () => {
    useBufferStore.getState().actions.openContent({
      type: "editor",
      path,
      name: "notes.md",
      content: "old",
    });
    disk.files.set(path, "new");
    await initializeFileWatcherListener();

    await disk.listeners.get("file-changed")?.({ payload: { path, event_type: "reloaded" } });

    expect(text()).toBe("new");
  });

  it("replaces earlier subscriptions and survives failing unsubscribes", async () => {
    await initializeFileWatcherListener();
    disk.failUnlisten = true;

    await initializeFileWatcherListener();

    expect(disk.unlistened).toHaveLength(2);
    expect(console.error).toHaveBeenCalledWith(
      "Error cleaning up file change listener:",
      expect.any(Error),
    );
  });
});
