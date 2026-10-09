import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands, type FileClipboardState } from "@/bindings/commands";
import {
  cleanupFileClipboardListener,
  initializeFileClipboardListener,
} from "../services/file-explorer-clipboard-listener";
import { useFileClipboardStore } from "../stores/file-explorer-clipboard.store";

const events = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlistened: [] as string[],
  failUnlisten: false,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, listener: (event: { payload: unknown }) => void) => {
    events.listeners.set(name, listener);
    return () => {
      events.unlistened.push(name);
      events.listeners.delete(name);
      if (events.failUnlisten) throw new Error("already gone");
    };
  },
}));

const entries = [
  { path: "/repo/a.ts", is_dir: false },
  { path: "/repo/src", is_dir: true },
];

const clipboard = () => useFileClipboardStore.getState().clipboard;
const actions = () => useFileClipboardStore.getState().actions;

beforeEach(() => {
  useFileClipboardStore.setState({ clipboard: null });
  events.listeners.clear();
  events.unlistened = [];
  events.failUnlisten = false;
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  events.failUnlisten = false;
  await cleanupFileClipboardListener();
  vi.restoreAllMocks();
});

describe("file explorer clipboard", () => {
  it("remembers copied and cut entries once the backend accepted them", async () => {
    vi.spyOn(commands, "clipboardSet").mockResolvedValue(null);

    await actions().copy(entries);
    expect(clipboard()).toEqual({ entries, operation: "copy" });
    expect(commands.clipboardSet).toHaveBeenCalledWith(entries, "copy");

    await actions().cut(entries.slice(0, 1));
    expect(clipboard()).toEqual({ entries: entries.slice(0, 1), operation: "cut" });
  });

  it("reports copy and cut failures without changing the clipboard", async () => {
    vi.spyOn(commands, "clipboardSet").mockRejectedValue(new Error("permission denied"));

    await actions().copy(entries);
    await actions().cut(entries);

    expect(clipboard()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Could not copy", {
      description: "permission denied",
    });
    expect(toast.error).toHaveBeenCalledWith("Could not cut", {
      description: "permission denied",
    });
  });

  it("pastes into a folder and syncs the clipboard the backend reports afterwards", async () => {
    const pasted = [{ source_path: "/repo/a.ts", destination_path: "/repo/lib/a.ts" }];
    vi.spyOn(commands, "clipboardPaste").mockResolvedValue(pasted as never);
    vi.spyOn(commands, "clipboardGet").mockResolvedValue(null);
    useFileClipboardStore.setState({ clipboard: { entries, operation: "cut" } });

    expect(await actions().paste("/repo/lib")).toEqual(pasted);
    expect(commands.clipboardPaste).toHaveBeenCalledWith("/repo/lib");
    expect(clipboard()).toBeNull();
  });

  it("still syncs the clipboard after a partially failed paste", async () => {
    const remaining: FileClipboardState = { entries: entries.slice(1), operation: "copy" };
    vi.spyOn(commands, "clipboardPaste").mockRejectedValue("target is read-only");
    vi.spyOn(commands, "clipboardGet").mockResolvedValue(remaining as never);

    expect(await actions().paste("/readonly")).toBeNull();

    expect(clipboard()).toEqual(remaining);
    expect(toast.error).toHaveBeenCalledWith("Could not paste", {
      description: "target is read-only",
    });
  });

  it("clears the clipboard, and treats an unreadable clipboard as empty", async () => {
    vi.spyOn(commands, "clipboardClear").mockResolvedValue(null);
    useFileClipboardStore.setState({ clipboard: { entries, operation: "copy" } });

    await actions().clear();
    expect(clipboard()).toBeNull();

    useFileClipboardStore.setState({ clipboard: { entries, operation: "copy" } });
    vi.spyOn(commands, "clipboardPaste").mockResolvedValue([]);
    vi.spyOn(commands, "clipboardGet").mockRejectedValue(new Error("gone"));
    await actions().paste("/repo");
    expect(clipboard()).toBeNull();
  });
});

describe("file clipboard listener", () => {
  it("mirrors clipboard changes made in other windows", async () => {
    await initializeFileClipboardListener();

    events.listeners.get("file-clipboard-changed")?.({ payload: { entries, operation: "cut" } });
    expect(clipboard()).toEqual({ entries, operation: "cut" });

    events.listeners.get("file-clipboard-cleared")?.({ payload: null });
    expect(clipboard()).toBeNull();
  });

  it("replaces earlier listeners when initialized again and survives failing cleanup", async () => {
    await initializeFileClipboardListener();
    events.failUnlisten = true;

    await initializeFileClipboardListener();

    expect(events.unlistened).toEqual(["file-clipboard-changed", "file-clipboard-cleared"]);
    expect(console.error).toHaveBeenCalledTimes(2);
    expect([...events.listeners.keys()].sort()).toEqual([
      "file-clipboard-changed",
      "file-clipboard-cleared",
    ]);
  });
});
