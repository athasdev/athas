// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { prepareProjectTransitionWithUnsavedBuffers } from "../services/workspace-project-transition";

const platform = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return { isMac: false, choice: vi.fn() };
});

vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  get IS_MAC() {
    return platform.isMac;
  },
}));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showChoiceDialog: platform.choice,
}));

enableMapSet();

const buffers = () => useBufferStore.getState().buffers;
const actions = () => useBufferStore.getState().actions;

function openDirty(path: string) {
  const id = actions().openContent({
    type: "editor",
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    content: "saved",
  });
  actions().markBufferDirty(id, true);
  return id;
}

let saved: string[];
let failingSaves: Set<string>;

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  platform.isMac = false;
  platform.choice.mockReset();
  saved = [];
  failingSaves = new Set();
  vi.spyOn(toast, "warning").mockImplementation(() => "");
  vi.spyOn(useEditorAppStore.getState().actions, "handleSave").mockImplementation(async () => {
    const activeId = getActiveBufferId();
    if (!activeId) return false;
    saved.push(activeId);
    if (failingSaves.has(activeId)) return false;
    actions().markBufferDirty(activeId, false);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("leaving a project with unsaved files", () => {
  it("continues without asking when nothing is dirty", async () => {
    actions().openContent({ type: "editor", path: "/repo/a.ts", name: "a.ts", content: "" });

    expect(await prepareProjectTransitionWithUnsavedBuffers("switching projects", buffers())).toBe(
      true,
    );
    expect(platform.choice).not.toHaveBeenCalled();
  });

  it("asks about one file by name and continues when the user discards", async () => {
    openDirty("/repo/a.ts");
    platform.choice.mockResolvedValue("discard");

    expect(
      await prepareProjectTransitionWithUnsavedBuffers("closing this project", buffers()),
    ).toBe(true);
    expect(platform.choice).toHaveBeenCalledWith(
      'Save changes to "a.ts" before closing this project?',
      expect.objectContaining({
        title: "Unsaved Changes",
        choices: expect.arrayContaining([
          expect.objectContaining({ value: "save", label: "Save" }),
          expect.objectContaining({ value: "discard", label: "Don't Save" }),
        ]),
      }),
    );
    expect(saved).toEqual([]);
  });

  it("stays put when the user cancels", async () => {
    openDirty("/repo/a.ts");
    platform.choice.mockResolvedValue(null);

    expect(await prepareProjectTransitionWithUnsavedBuffers("switching projects", buffers())).toBe(
      false,
    );
  });

  it("saves every dirty file before continuing", async () => {
    const first = openDirty("/repo/a.ts");
    const second = openDirty("/repo/b.ts");
    platform.choice.mockResolvedValue("save");

    expect(await prepareProjectTransitionWithUnsavedBuffers("switching projects", buffers())).toBe(
      true,
    );
    expect(saved).toEqual([first, second]);
    expect(buffers().every((buffer) => !("isDirty" in buffer) || !buffer.isDirty)).toBe(true);
  });

  it("stops when a file could not be saved", async () => {
    const first = openDirty("/repo/a.ts");
    const second = openDirty("/repo/b.ts");
    failingSaves.add(first);
    platform.choice.mockResolvedValue("save");

    expect(await prepareProjectTransitionWithUnsavedBuffers("switching projects", buffers())).toBe(
      false,
    );
    expect(saved).toEqual([first]);
    expect(saved).not.toContain(second);
    expect(toast.warning).toHaveBeenCalledWith('Save "a.ts" before continuing.');
  });

  it("refuses to continue while other files are still unsaved", async () => {
    const first = openDirty("/repo/a.ts");
    openDirty("/repo/b.ts");
    platform.choice.mockResolvedValue("save");

    const onlyFirst = buffers().filter((buffer) => buffer.id === first);
    expect(await prepareProjectTransitionWithUnsavedBuffers("switching projects", onlyFirst)).toBe(
      false,
    );
    expect(toast.warning).toHaveBeenCalledWith("Save or close 1 unsaved files before continuing.");
  });

  it("skips files that were saved or closed while the prompt was open", async () => {
    const first = openDirty("/repo/a.ts");
    const second = openDirty("/repo/b.ts");
    const snapshot = buffers();
    platform.choice.mockImplementation(async () => {
      actions().markBufferDirty(first, false);
      actions().closeBufferForce(second);
      return "save";
    });

    expect(await prepareProjectTransitionWithUnsavedBuffers("switching projects", snapshot)).toBe(
      true,
    );
    expect(saved).toEqual([]);
  });

  it("uses the native sheet on macOS", async () => {
    platform.isMac = true;
    openDirty("/repo/a.ts");
    openDirty("/repo/b.ts");
    const sheet = vi
      .spyOn(commands, "showNativeChoiceSheet")
      .mockResolvedValueOnce("secondary")
      .mockResolvedValueOnce("cancel" as never)
      .mockResolvedValueOnce("primary");

    expect(
      await prepareProjectTransitionWithUnsavedBuffers("restarting to update", buffers()),
    ).toBe(true);
    expect(sheet).toHaveBeenCalledWith(
      "Save changes to 2 files before restarting to update?",
      "Unsaved changes will be lost if you continue without saving.",
      "Save All",
      "Discard All",
      "Cancel",
    );
    expect(await prepareProjectTransitionWithUnsavedBuffers("switching projects", buffers())).toBe(
      false,
    );
    expect(await prepareProjectTransitionWithUnsavedBuffers("switching projects", buffers())).toBe(
      true,
    );
    expect(saved).toHaveLength(2);
    expect(platform.choice).not.toHaveBeenCalled();
  });
});
