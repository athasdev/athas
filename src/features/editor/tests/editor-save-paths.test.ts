// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { onAppEvent } from "@/utils/app-events";
import { captureBufferStoreOwner } from "../services/buffer-store-owner";
import {
  AUTO_SAVE_DELAY_MS,
  cleanupEditorAutoSave,
  saveEditorBufferById,
  scheduleEditorAutoSave,
} from "../services/editor-save-service";
import { buildCollaborationNoteBufferPath } from "../services/virtual-buffer-paths";
import { useBufferStore } from "../stores/buffer.store";

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  recordLocalHistoryFile: vi.fn(),
  notifyDocumentSave: vi.fn(),
  lintContent: vi.fn(),
  toast: vi.fn(),
  updateChannelNote: vi.fn(),
  setCollaborationSnapshot: vi.fn(),
  collaboration: null as null | {
    channelNotes: Array<{ channelId: number; contentMarkdown: string }>;
  },
}));

vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ writeText: mocks.writeText }),
}));
vi.mock("@/features/local-history/api/local-history-api", () => ({
  recordLocalHistoryFile: mocks.recordLocalHistoryFile,
}));
vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: { getInstance: () => ({ notifyDocumentSave: mocks.notifyDocumentSave }) },
}));
vi.mock("@/features/editor/services/linter-service", () => ({ lintContent: mocks.lintContent }));
vi.mock("@/utils/toast", () => ({ showToast: mocks.toast }));
vi.mock("@/features/collaboration/services/collaboration-api", () => ({
  updateCollaborationChannelNote: mocks.updateChannelNote,
}));
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: {
    getState: () => ({
      subscription: { collaboration: mocks.collaboration },
      actions: { setCollaborationSnapshot: mocks.setCollaborationSnapshot },
    }),
  },
}));

function editor(id: string, path: string, content: string, extra: Partial<EditorContent> = {}) {
  return {
    id,
    type: "editor",
    path,
    name: path.split("/").pop()!,
    content,
    savedContent: "",
    isDirty: true,
    isVirtual: false,
    language: "typescript",
    ...extra,
  } satisfies EditorContent;
}

function open(buffer: EditorContent) {
  useBufferStore.setState({ buffers: [buffer] });
  seedActiveBuffer(buffer.id);
}

const save = (id: string, reason: "save" | "auto-save" = "save") =>
  saveEditorBufferById(captureBufferStoreOwner(), id, reason);
const bufferOf = (id: string) =>
  useBufferStore.getState().buffers.find((buffer) => buffer.id === id) as EditorContent;

function setSettings(patch: Record<string, unknown>) {
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, ...patch } }));
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  setSettings({ autoSave: false, formatOnSave: false, lintOnSave: false });
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  mocks.recordLocalHistoryFile.mockReset().mockResolvedValue(undefined);
  mocks.notifyDocumentSave.mockReset().mockResolvedValue(undefined);
  mocks.lintContent.mockReset();
  mocks.toast.mockReset();
  mocks.updateChannelNote.mockReset();
  mocks.collaboration = null;
  useDiagnosticsStore.getState().actions.clearAllDiagnostics();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanupEditorAutoSave();
  workspaceRuntimeRegistry.resetForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("saving files", () => {
  it("writes the file, marks it saved and announces the git change", async () => {
    useProjectStore.setState({ rootFolderPath: "/ws" });
    open(editor("a", "/ws/a.ts", "const a = 1;"));
    const changes: unknown[] = [];
    const stop = onAppEvent("git:changed", (change) => changes.push(change));

    await expect(save("a")).resolves.toBe(true);
    stop();

    expect(mocks.writeText).toHaveBeenCalledWith("/ws/a.ts", "const a = 1;", "");
    expect(bufferOf("a")).toMatchObject({ isDirty: false, savedContent: "const a = 1;" });
    expect(changes).toContainEqual(
      expect.objectContaining({ repoPath: "/ws", filePath: "/ws/a.ts", source: "save" }),
    );
    expect(mocks.notifyDocumentSave).toHaveBeenCalledWith("/ws/a.ts");
  });

  it("still saves when local history cannot be recorded", async () => {
    open(editor("a", "/ws/a.ts", "text"));
    mocks.recordLocalHistoryFile.mockRejectedValueOnce(new Error("disk full"));

    await expect(save("a")).resolves.toBe(true);

    expect(mocks.writeText).toHaveBeenCalled();
    expect(bufferOf("a").isDirty).toBe(false);
  });

  it("keeps the buffer dirty and explains a failed write", async () => {
    open(editor("a", "/ws/a.ts", "text"));
    mocks.writeText.mockRejectedValueOnce(new Error("EACCES"));

    await expect(save("a")).resolves.toBe(false);

    expect(bufferOf("a").isDirty).toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith({
      message: "Could not save a.ts: Error: EACCES",
      type: "error",
    });
  });

  it("lints after saving and stores the findings", async () => {
    setSettings({ lintOnSave: true });
    open(editor("a", "/ws/a.ts", "let x"));
    mocks.lintContent.mockResolvedValueOnce({
      success: true,
      diagnostics: [{ line: 1, column: 5, severity: "warning", message: "missing semicolon" }],
    });

    await save("a");

    expect(useDiagnosticsStore.getState().actions.getDiagnosticsForFile("/ws/a.ts")).toEqual([
      expect.objectContaining({
        severity: "warning",
        line: 0,
        column: 4,
        message: "missing semicolon",
      }),
    ]);
  });

  it("keeps the save when post-save tooling fails", async () => {
    setSettings({ lintOnSave: true });
    open(editor("a", "/ws/a.ts", "x"));
    mocks.notifyDocumentSave.mockRejectedValueOnce(new Error("lsp down"));

    await expect(save("a")).resolves.toBe(true);
    expect(mocks.lintContent).not.toHaveBeenCalled();
    expect(bufferOf("a").isDirty).toBe(false);
  });

  it("does not save read-only or missing buffers", async () => {
    open(editor("a", "/ws/a.ts", "x", { readOnly: true }));
    await expect(save("a")).resolves.toBe(false);
    await expect(save("missing")).resolves.toBe(false);
    expect(mocks.writeText).not.toHaveBeenCalled();
  });
});

describe("virtual buffers", () => {
  it("applies the settings JSON buffer to settings", async () => {
    open(
      editor("settings", "settings://user-settings.json", "", {
        isVirtual: true,
        content: JSON.stringify({ ...useSettingsStore.getState().settings, fontSize: 19 }),
      }),
    );

    await expect(save("settings")).resolves.toBe(true);

    expect(useSettingsStore.getState().settings.fontSize).toBe(19);
    expect(bufferOf("settings").isDirty).toBe(false);
    expect(mocks.writeText).not.toHaveBeenCalled();
  });

  it("keeps an invalid settings JSON buffer dirty", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    open(
      editor("settings", "settings://user-settings.json", "{ nope", {
        isVirtual: true,
        isDirty: false,
      }),
    );

    await expect(save("settings")).resolves.toBe(false);
    expect(bufferOf("settings").isDirty).toBe(true);
  });

  it("marks other virtual buffers clean without writing", async () => {
    open(editor("scratch", "scratch://notes", "draft", { isVirtual: true }));
    await expect(save("scratch")).resolves.toBe(true);
    expect(bufferOf("scratch").isDirty).toBe(false);
    expect(mocks.writeText).not.toHaveBeenCalled();
  });
});

describe("collaboration notes", () => {
  const path = buildCollaborationNoteBufferPath(7, "plan.md");

  it("saves a channel note through the collaboration service", async () => {
    mocks.collaboration = {
      channelNotes: [{ channelId: 7, contentMarkdown: "" }],
    };
    const snapshot = { channelNotes: [] };
    mocks.updateChannelNote.mockResolvedValueOnce(snapshot);
    open(editor("note", path, "# Plan\n- ship", { isVirtual: true }));

    await expect(save("note")).resolves.toBe(true);

    expect(mocks.updateChannelNote).toHaveBeenCalledWith({
      channelId: 7,
      contentMarkdown: expect.any(String),
    });
    expect(mocks.setCollaborationSnapshot).toHaveBeenCalledWith(snapshot);
    expect(bufferOf("note")).toMatchObject({ isDirty: false, savedContent: "# Plan\n- ship" });
  });

  it("keeps the note dirty when its channel is gone", async () => {
    mocks.collaboration = { channelNotes: [] };
    open(editor("note", path, "text", { isVirtual: true, isDirty: false }));

    await expect(save("note")).resolves.toBe(false);

    expect(mocks.updateChannelNote).not.toHaveBeenCalled();
    expect(bufferOf("note").isDirty).toBe(true);
  });

  it("reports a failed note save", async () => {
    mocks.collaboration = { channelNotes: [{ channelId: 7, contentMarkdown: "" }] };
    mocks.updateChannelNote.mockRejectedValueOnce(new Error("offline"));
    open(editor("note", path, "text", { isVirtual: true }));

    await expect(save("note")).resolves.toBe(false);

    expect(mocks.toast).toHaveBeenCalledWith({
      message: "Could not save the file: Error: offline",
      type: "error",
    });
  });
});

describe("auto-save", () => {
  it("saves once after typing pauses, and only when enabled", async () => {
    vi.useFakeTimers();
    setSettings({ autoSave: true });
    open(editor("a", "/ws/a.ts", "typed"));

    scheduleEditorAutoSave("a");
    vi.advanceTimersByTime(AUTO_SAVE_DELAY_MS - 1);
    scheduleEditorAutoSave("a");
    vi.advanceTimersByTime(AUTO_SAVE_DELAY_MS - 1);
    expect(mocks.writeText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(mocks.writeText).toHaveBeenCalledTimes(1));
    expect(mocks.recordLocalHistoryFile).toHaveBeenCalledWith("/ws/a.ts", "auto-save");
    expect(mocks.notifyDocumentSave).not.toHaveBeenCalled();
  });

  it("skips auto-save when it is off and cancels pending timers on cleanup", async () => {
    vi.useFakeTimers();
    open(editor("a", "/ws/a.ts", "typed"));
    await expect(save("a", "auto-save")).resolves.toBe(false);

    setSettings({ autoSave: true });
    scheduleEditorAutoSave("a");
    cleanupEditorAutoSave();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS * 2);

    expect(mocks.writeText).not.toHaveBeenCalled();
  });
});
