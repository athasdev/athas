// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  sonner: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
  dialogOpen: vi.fn(),
  dialogSave: vi.fn(),
  writeTextFile: vi.fn(async () => {}),
  clipboardWrite: vi.fn(async () => {}),
  clipboardRead: vi.fn(async () => "from tauri"),
}));

vi.mock("sonner", () => ({ toast: harness.sonner }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: harness.dialogOpen,
  save: harness.dialogSave,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: harness.writeTextFile,
  exists: vi.fn(async (path: string) => path === "/exists"),
  readDir: vi.fn(async () => [{ name: "a.ts" }]),
  readFile: vi.fn(async () => new Uint8Array([1, 2])),
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/Users/dev" }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: harness.clipboardWrite,
  readText: harness.clipboardRead,
}));

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { commands } from "@/bindings/commands";
import { onAppEvent } from "@/utils/app-events";
import { readClipboardText, tryWriteClipboardText, writeClipboardText } from "@/utils/clipboard";
import {
  formatCalendarDateGroup,
  formatCompactRelativeDate,
  formatRelativeTime,
  formatShortDate,
  formatShortDateTime,
  formatTimeOfDay,
} from "@/utils/date";
import {
  pickDirectory,
  pickFile,
  pickFiles,
  pickSavePath,
  saveTextFileWithDialog,
} from "@/utils/file-dialogs";
import { calculateFrecencyScore } from "@/utils/frecency";
import { resolveEscapeGuard } from "@/utils/keyboard/escape-guard";
import { isNativeTextInputTarget } from "@/utils/keyboard/text-input-target";
import {
  getHomeDirectory,
  listDirectoryEntries,
  openFileInDefaultApp,
  pathExists,
  readFileBytes,
  showSystemSharePicker,
  toggleQuickLookPreview,
} from "@/utils/local-files";
import { showToast, useToast } from "@/utils/toast";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const NOW = new Date("2026-06-15T12:00:00Z").getTime();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("toasts", () => {
  function renderToastApi() {
    const result = {} as { current: ReturnType<typeof useToast> };
    function Probe() {
      result.current = useToast();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    return result;
  }

  it("shows each toast type with its options", () => {
    const action = { label: "Undo", onClick: vi.fn() };

    showToast({ key: "s", message: "Saved", type: "success", action, duration: 2_000 });
    showToast({ key: "w", message: "Careful", type: "warning" });
    showToast({ key: "e", message: "Failed", description: "disk full", type: "error" });
    showToast({ key: "i", message: "FYI", type: "info" });

    expect(harness.sonner.success).toHaveBeenCalledWith(
      "Saved",
      expect.objectContaining({ id: "s", action, duration: 2_000 }),
    );
    expect(harness.sonner.warning).toHaveBeenCalledWith(
      "Careful",
      expect.objectContaining({ id: "w" }),
    );
    expect(harness.sonner.error).toHaveBeenCalledWith(
      "Failed",
      expect.objectContaining({ id: "e", description: "disk full" }),
    );
    expect(harness.sonner.info).toHaveBeenCalledWith("FYI", expect.objectContaining({ id: "i" }));
  });

  it("generates ids for unkeyed toasts", () => {
    const first = showToast({ message: "a", type: "info" });
    const second = showToast({ message: "b", type: "info" });

    expect(first).not.toBe(second);
  });

  it("updates, tracks and dismisses active toasts", () => {
    const api = renderToastApi();
    const dismissed: unknown[] = [];
    const stop = onAppEvent("toast:dismissed", (detail) => dismissed.push(detail));

    const id = api.current.showToast({ key: "upload", message: "Uploading", type: "info" });
    expect(api.current.hasToast(id)).toBe(true);

    api.current.updateToast(id, { message: "Uploaded", type: "success" });
    expect(harness.sonner.success).toHaveBeenCalledWith(
      "Uploaded",
      expect.objectContaining({ id: "upload" }),
    );

    api.current.updateToast("missing", { message: "x" });
    expect(harness.sonner.success).toHaveBeenCalledOnce();

    api.current.dismissToast(id);
    expect(harness.sonner.dismiss).toHaveBeenCalledWith("upload");
    expect(api.current.hasToast(id)).toBe(false);
    api.current.dismissToast(id);
    stop();

    expect(dismissed).toEqual([{ toastId: "upload" }]);
  });

  it("forgets toasts that close on their own", () => {
    const api = renderToastApi();
    showToast({ key: "auto", message: "Done", type: "info" });
    showToast({ key: "manual", message: "Done", type: "info" });
    const [, autoOptions] = harness.sonner.info.mock.calls[0] as [
      string,
      { onAutoClose: () => void },
    ];
    const [, manualOptions] = harness.sonner.info.mock.calls[1] as [
      string,
      { onDismiss: () => void },
    ];

    autoOptions.onAutoClose();
    manualOptions.onDismiss();

    expect(api.current.hasToast("auto")).toBe(false);
    expect(api.current.hasToast("manual")).toBe(false);
  });
});

describe("dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("formats unix timestamps relative to now", () => {
    const seconds = NOW / 1000;

    expect(formatRelativeTime(seconds - 30)).toBe("30 seconds ago");
    expect(formatRelativeTime(seconds - 120)).toBe("2 minutes ago");
    expect(formatRelativeTime(seconds - 3 * 3600)).toBe("3 hours ago");
    expect(formatRelativeTime(seconds - 2 * 86400)).toBe("2 days ago");
    expect(formatRelativeTime(seconds - 90 * 86400)).toBe("3 months ago");
  });

  it("formats short dates and keeps unparseable input", () => {
    expect(formatShortDate("2024-01-20T12:00:00Z")).toBe("Jan 20, 2024");
    expect(formatShortDate("not a date")).toBe("not a date");
    expect(formatShortDate(new Date(Number.NaN))).toBe("unknown");
    expect(formatShortDateTime("garbage")).toBe("garbage");
    expect(formatShortDateTime(Number.NaN)).toBe("unknown");
    expect(formatShortDateTime(NOW)).toMatch(/^Jun 15/);
    expect(formatTimeOfDay("garbage")).toBe("");
    expect(formatTimeOfDay(NOW)).not.toBe("");
  });

  it("formats compact relative dates with the requested style", () => {
    const at = (ms: number) => new Date(NOW - ms);
    const day = 86_400_000;

    expect(formatCompactRelativeDate(at(10_000), { capitalizeJustNow: true })).toBe("Just now");
    expect(formatCompactRelativeDate(at(2 * day))).toBe("2d ago");
    expect(formatCompactRelativeDate(at(day), { afterWeek: "days" })).toBe("1d ago");
    expect(formatCompactRelativeDate(at(20 * day), { afterWeek: "days" })).toBe("20d ago");
    expect(formatCompactRelativeDate(at(20 * day), { afterWeek: "weeks", includeAgo: false })).toBe(
      "2w",
    );
    expect(formatCompactRelativeDate(at(20 * day))).toBe("5/26/2026");
    expect(formatCompactRelativeDate(Number.NaN)).toBe("unknown");
    expect(formatCompactRelativeDate("bad", { fallback: "—" })).toBe("—");
  });

  it("groups dates by calendar day", () => {
    expect(formatCalendarDateGroup(NOW)).toBe("Today");
    expect(formatCalendarDateGroup(NOW - 86_400_000)).toBe("Yesterday");
    expect(formatCalendarDateGroup("bad")).toBe("Unknown");
    expect(formatCalendarDateGroup(NOW - 10 * 86_400_000)).not.toMatch(/\d{4}/);
    expect(formatCalendarDateGroup("2020-03-04T12:00:00Z")).toMatch(/2020/);
  });
});

describe("frecency", () => {
  it("rewards frequent and recent access", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const now = new Date(NOW);
    const weekAgo = new Date(NOW - 7 * 86_400_000).toISOString();

    expect(calculateFrecencyScore(0, now)).toBeCloseTo(30);
    expect(calculateFrecencyScore(0, weekAgo)).toBeCloseTo(15);
    expect(calculateFrecencyScore(9, now)).toBeCloseTo(100);
    expect(calculateFrecencyScore(999, now)).toBe(100);
    expect(calculateFrecencyScore(3, now)).toBeGreaterThan(calculateFrecencyScore(3, weekAgo));
  });
});

describe("file dialogs", () => {
  it("returns single selections and ignores cancelled pickers", async () => {
    harness.dialogOpen.mockResolvedValueOnce("/repo").mockResolvedValueOnce(null);
    harness.dialogOpen.mockResolvedValueOnce("/repo/a.ts").mockResolvedValueOnce(["/x", "/y"]);

    await expect(pickDirectory({ title: "Open" })).resolves.toBe("/repo");
    await expect(pickDirectory()).resolves.toBeNull();
    await expect(pickFile()).resolves.toBe("/repo/a.ts");
    await expect(pickFile()).resolves.toBeNull();

    expect(harness.dialogOpen.mock.calls[0][0]).toEqual({
      title: "Open",
      directory: true,
      multiple: false,
    });
  });

  it("normalizes multi-file selections", async () => {
    harness.dialogOpen
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("/one")
      .mockResolvedValueOnce(["/a", "/b"]);

    await expect(pickFiles()).resolves.toEqual([]);
    await expect(pickFiles()).resolves.toEqual(["/one"]);
    await expect(pickFiles({ filters: [{ name: "TS", extensions: ["ts"] }] })).resolves.toEqual([
      "/a",
      "/b",
    ]);
  });

  it("saves text only when a path was chosen", async () => {
    const contents = vi.fn(() => "data");
    harness.dialogSave
      .mockResolvedValueOnce("/tmp/out.json")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("/tmp/x");

    await expect(saveTextFileWithDialog({ defaultPath: "out.json" }, contents)).resolves.toBe(
      "/tmp/out.json",
    );
    await expect(saveTextFileWithDialog({}, contents)).resolves.toBeNull();
    await expect(pickSavePath({})).resolves.toBe("/tmp/x");

    expect(harness.writeTextFile).toHaveBeenCalledExactlyOnceWith("/tmp/out.json", "data");
    expect(contents).toHaveBeenCalledOnce();
  });
});

describe("local files", () => {
  it("reads through the filesystem plugin and opens files natively", async () => {
    const openExternal = vi.spyOn(commands, "openFileExternal").mockResolvedValue(null);
    const quickLook = vi.spyOn(commands, "toggleQuickLook").mockResolvedValue(null);
    const share = vi.spyOn(commands, "showSharePicker").mockResolvedValue(null);

    await expect(pathExists("/exists")).resolves.toBe(true);
    await expect(pathExists("/missing")).resolves.toBe(false);
    await expect(readFileBytes("/a.bin")).resolves.toEqual(new Uint8Array([1, 2]));
    await expect(listDirectoryEntries("/repo")).resolves.toEqual([{ name: "a.ts" }]);
    await expect(getHomeDirectory()).resolves.toBe("/Users/dev");
    await openFileInDefaultApp("/a.pdf");
    await toggleQuickLookPreview("/a.png");
    await showSystemSharePicker("/a.txt");

    expect(openExternal).toHaveBeenCalledWith("/a.pdf");
    expect(quickLook).toHaveBeenCalledWith("/a.png");
    expect(share).toHaveBeenCalledWith("/a.txt");
  });
});

describe("clipboard", () => {
  it("uses the native clipboard when available", async () => {
    await writeClipboardText("hello");
    await expect(readClipboardText()).resolves.toBe("from tauri");

    expect(harness.clipboardWrite).toHaveBeenCalledWith("hello");
  });

  it("falls back to the browser clipboard", async () => {
    harness.clipboardWrite.mockRejectedValueOnce(new Error("no plugin"));
    harness.clipboardRead.mockRejectedValueOnce(new Error("no plugin"));
    const writeText = vi.fn(async () => {});
    const readText = vi.fn(async () => "from browser");
    vi.stubGlobal("navigator", { clipboard: { writeText, readText } });

    await writeClipboardText("x");
    await expect(readClipboardText()).resolves.toBe("from browser");

    expect(writeText).toHaveBeenCalledWith("x");
  });

  it("reports when no clipboard is available", async () => {
    harness.clipboardWrite.mockRejectedValue(new Error("no plugin"));
    harness.clipboardRead.mockRejectedValueOnce(new Error("no plugin"));
    vi.stubGlobal("navigator", {});

    await expect(writeClipboardText("x")).rejects.toThrow("Clipboard write API is unavailable.");
    await expect(readClipboardText()).rejects.toThrow("Clipboard read API is unavailable.");
    await expect(tryWriteClipboardText("x")).resolves.toBe(false);
    harness.clipboardWrite.mockReset();
    await expect(tryWriteClipboardText("x")).resolves.toBe(true);
  });
});

describe("keyboard targets", () => {
  function element(html: string) {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    return host;
  }

  it("lets open popups handle Escape before blurring inputs", () => {
    const host = element(
      '<div role="combobox"><input id="combo"></div><textarea id="text"></textarea><span id="plain"></span>',
    );
    const combo = host.querySelector("#combo")!;
    const text = host.querySelector("#text")!;
    const plain = host.querySelector("#plain")!;

    expect(resolveEscapeGuard(text, combo).dismissTarget?.getAttribute("role")).toBe("combobox");
    expect(resolveEscapeGuard(plain, text)).toEqual({ dismissTarget: null, blurTarget: text });
    expect(resolveEscapeGuard(plain, null)).toEqual({ dismissTarget: null, blurTarget: null });
    host.remove();
  });

  it("recognizes text inputs but not buttons or checkboxes", () => {
    const host = element(
      '<input id="text" type="text"><input id="box" type="checkbox"><textarea id="area"></textarea><div id="rich" contenteditable="true"></div><div id="plain"></div>',
    );
    const rich = host.querySelector<HTMLElement>("#rich")!;
    Object.defineProperty(rich, "isContentEditable", { value: true });

    expect(isNativeTextInputTarget(host.querySelector("#text"), null)).toBe(true);
    expect(isNativeTextInputTarget(host.querySelector("#box"), null)).toBe(false);
    expect(isNativeTextInputTarget(host.querySelector("#area"), null)).toBe(true);
    expect(isNativeTextInputTarget(rich, null)).toBe(true);
    expect(isNativeTextInputTarget(host.querySelector("#plain"), null)).toBe(false);
    expect(isNativeTextInputTarget(null, host.querySelector("#area"))).toBe(true);
    expect(isNativeTextInputTarget(window, null)).toBe(false);
    host.remove();
  });
});
