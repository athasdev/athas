import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  fallbackFolderPicker: vi.fn(),
  homeDir: vi.fn(),
  isLinux: true,
  openDialog: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("@/utils/platform", () => ({
  get IS_LINUX() {
    return mocks.isLinux;
  },
}));

vi.mock("@/features/file-system/stores/linux-folder-picker.store", () => ({
  useLinuxFolderPickerStore: {
    getState: () => ({
      actions: {
        open: mocks.fallbackFolderPicker,
      },
    }),
  },
}));

vi.mock("@/features/wsl/utils/wsl-path", () => ({ parseWslPath: vi.fn(() => null) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: mocks.homeDir }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openDialog }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 0 },
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  remove: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { openFile, openFiles, openFolder } from "../controllers/platform";

describe("platform dialogs", () => {
  beforeEach(() => {
    mocks.isLinux = true;
    mocks.openDialog.mockReset();
    mocks.fallbackFolderPicker.mockReset();
    mocks.homeDir.mockReset();
    mocks.homeDir.mockResolvedValue("/home/athas");
    mocks.prompt.mockReset();
    vi.stubGlobal("window", { prompt: mocks.prompt });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens the native single-folder dialog on Linux", async () => {
    mocks.openDialog.mockResolvedValue("/workspace/project");

    await expect(openFolder()).resolves.toBe("/workspace/project");

    expect(mocks.openDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(mocks.fallbackFolderPicker).not.toHaveBeenCalled();
  });

  it("treats native folder-dialog cancellation as cancellation", async () => {
    mocks.openDialog.mockResolvedValue(null);

    await expect(openFolder()).resolves.toBeNull();

    expect(mocks.fallbackFolderPicker).not.toHaveBeenCalled();
  });

  it("uses the Athas folder picker when the Linux native dialog invocation fails", async () => {
    mocks.openDialog.mockRejectedValue(new Error("portal unavailable"));
    mocks.fallbackFolderPicker.mockResolvedValue("/workspace/fallback");

    await expect(openFolder()).resolves.toBe("/workspace/fallback");

    expect(mocks.fallbackFolderPicker).toHaveBeenCalledOnce();
  });

  it("preserves cancellation from the Athas folder picker fallback", async () => {
    mocks.openDialog.mockRejectedValue(new Error("portal unavailable"));
    mocks.fallbackFolderPicker.mockResolvedValue(null);

    await expect(openFolder()).resolves.toBeNull();
  });

  it("uses native single-file selection on Linux", async () => {
    mocks.openDialog.mockResolvedValue("/workspace/file.ts");

    await expect(openFile()).resolves.toBe("/workspace/file.ts");

    expect(mocks.openDialog).toHaveBeenCalledWith({ directory: false, multiple: false });
  });

  it("does not open path entry after native single-file cancellation", async () => {
    mocks.openDialog.mockResolvedValue(null);

    await expect(openFile()).resolves.toBeNull();

    expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it("falls back to an expanded Linux path when native single-file selection fails", async () => {
    mocks.openDialog.mockRejectedValue(new Error("portal unavailable"));
    mocks.prompt.mockReturnValue("~/src/file.ts");

    await expect(openFile()).resolves.toBe("/home/athas/src/file.ts");
  });

  it("uses native multi-file selection on Linux", async () => {
    mocks.openDialog.mockResolvedValue(["/workspace/a.ts", "/workspace/b.ts"]);

    await expect(openFiles()).resolves.toEqual(["/workspace/a.ts", "/workspace/b.ts"]);

    expect(mocks.openDialog).toHaveBeenCalledWith({ directory: false, multiple: true });
  });

  it("returns an empty selection after native multi-file cancellation", async () => {
    mocks.openDialog.mockResolvedValue(null);

    await expect(openFiles()).resolves.toEqual([]);

    expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it("normalizes a single native result from multi-file selection", async () => {
    mocks.openDialog.mockResolvedValue("/workspace/only.ts");

    await expect(openFiles()).resolves.toEqual(["/workspace/only.ts"]);
  });

  it("uses path entry when native multi-file selection fails on Linux", async () => {
    mocks.openDialog.mockRejectedValue(new Error("portal unavailable"));
    mocks.prompt.mockReturnValue("/workspace/fallback.ts");

    await expect(openFiles()).resolves.toEqual(["/workspace/fallback.ts"]);
  });

  it("preserves cancellation from multi-file path entry", async () => {
    mocks.openDialog.mockRejectedValue(new Error("portal unavailable"));
    mocks.prompt.mockReturnValue(null);

    await expect(openFiles()).resolves.toEqual([]);
  });

  it("does not hide native dialog errors on other platforms", async () => {
    const error = new Error("native dialog failed");
    mocks.isLinux = false;
    mocks.openDialog.mockRejectedValue(error);

    await expect(openFolder()).rejects.toBe(error);

    expect(mocks.fallbackFolderPicker).not.toHaveBeenCalled();
  });

  it("does not use Linux file fallbacks on other platforms", async () => {
    const error = new Error("native dialog failed");
    mocks.isLinux = false;
    mocks.openDialog.mockRejectedValue(error);

    await expect(openFile()).rejects.toBe(error);
    await expect(openFiles()).rejects.toBe(error);

    expect(mocks.prompt).not.toHaveBeenCalled();
  });
});
