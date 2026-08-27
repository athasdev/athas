import { describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent, PaneContent } from "@/features/panes/types/pane-content.types";
import { prepareWorkspaceClose } from "../services/workspace-close-guard";

function createEditorBuffer(overrides: Partial<EditorContent> = {}): EditorContent {
  return {
    id: "editor",
    type: "editor",
    path: "/workspace/app.ts",
    name: "app.ts",
    isPinned: false,
    isPreview: false,
    isActive: true,
    content: "changed",
    savedContent: "saved",
    isDirty: false,
    isVirtual: false,
    tokens: [],
    ...overrides,
  };
}

describe("workspace close guard", () => {
  it("allows a clean inactive workspace without activating or prompting it", async () => {
    const switchToWorkspace = vi.fn(async () => true);
    const confirmUnsavedBuffers = vi.fn(async () => true);

    await expect(
      prepareWorkspaceClose({
        workspaceId: "workspace:b",
        getActiveWorkspaceId: () => "workspace:a",
        getBuffers: () => [createEditorBuffer()],
        switchToWorkspace,
        confirmUnsavedBuffers,
      }),
    ).resolves.toBe(true);

    expect(switchToWorkspace).not.toHaveBeenCalled();
    expect(confirmUnsavedBuffers).not.toHaveBeenCalled();
  });

  it("prompts dirty buffers in the active workspace without switching", async () => {
    const buffers = [createEditorBuffer({ isDirty: true })];
    const switchToWorkspace = vi.fn(async () => true);
    const confirmUnsavedBuffers = vi.fn(async () => true);

    await expect(
      prepareWorkspaceClose({
        workspaceId: "workspace:a",
        getActiveWorkspaceId: () => "workspace:a",
        getBuffers: () => buffers,
        switchToWorkspace,
        confirmUnsavedBuffers,
      }),
    ).resolves.toBe(true);

    expect(switchToWorkspace).not.toHaveBeenCalled();
    expect(confirmUnsavedBuffers).toHaveBeenCalledWith(buffers);
  });

  it("activates a dirty inactive workspace before reading its buffers for confirmation", async () => {
    const firstBuffers = [createEditorBuffer({ id: "before", isDirty: true })];
    const activeBuffers = [createEditorBuffer({ id: "after", isDirty: true })];
    const events: string[] = [];
    let bufferReadCount = 0;
    const getBuffers = vi.fn(() => {
      bufferReadCount += 1;
      events.push(`read:${bufferReadCount}`);
      return bufferReadCount === 1 ? firstBuffers : activeBuffers;
    });
    const switchToWorkspace = vi.fn(async () => {
      events.push("switch");
      return true;
    });
    const confirmUnsavedBuffers = vi.fn(async (buffers: PaneContent[]) => {
      events.push(`confirm:${buffers[0]?.id}`);
      return true;
    });

    await expect(
      prepareWorkspaceClose({
        workspaceId: "workspace:b",
        getActiveWorkspaceId: () => "workspace:a",
        getBuffers,
        switchToWorkspace,
        confirmUnsavedBuffers,
      }),
    ).resolves.toBe(true);

    expect(switchToWorkspace).toHaveBeenCalledWith("workspace:b");
    expect(confirmUnsavedBuffers).toHaveBeenCalledWith(activeBuffers);
    expect(events).toEqual(["read:1", "switch", "read:2", "confirm:after"]);
  });

  it("stops before prompting when an inactive dirty workspace cannot activate", async () => {
    const confirmUnsavedBuffers = vi.fn(async () => true);

    await expect(
      prepareWorkspaceClose({
        workspaceId: "workspace:b",
        getActiveWorkspaceId: () => "workspace:a",
        getBuffers: () => [createEditorBuffer({ isDirty: true })],
        switchToWorkspace: async () => false,
        confirmUnsavedBuffers,
      }),
    ).resolves.toBe(false);

    expect(confirmUnsavedBuffers).not.toHaveBeenCalled();
  });

  it("preserves cancellation from the unsaved-buffer prompt", async () => {
    await expect(
      prepareWorkspaceClose({
        workspaceId: "workspace:a",
        getActiveWorkspaceId: () => "workspace:a",
        getBuffers: () => [createEditorBuffer({ isDirty: true })],
        switchToWorkspace: async () => true,
        confirmUnsavedBuffers: async () => false,
      }),
    ).resolves.toBe(false);
  });
});
