import { describe, expect, it, vi } from "vite-plus/test";
import { editorAPI, type ActiveEditorAdapter } from "../services/editor-api";

describe("editor API line commands", () => {
  it("are carried out by the active editor adapter when it provides them", () => {
    const commands = {
      toggleComment: vi.fn(),
      duplicateLine: vi.fn(),
      deleteLine: vi.fn(),
      moveLineUp: vi.fn(),
      moveLineDown: vi.fn(),
      copyLineUp: vi.fn(),
      copyLineDown: vi.fn(),
    };
    const adapter = {
      ownerId: "codemirror-commands-test",
      ...commands,
    } as unknown as ActiveEditorAdapter;

    editorAPI.setActiveEditorAdapter(adapter);
    try {
      editorAPI.toggleComment();
      editorAPI.duplicateLine();
      editorAPI.deleteLine();
      editorAPI.moveLineUp();
      editorAPI.moveLineDown();
      editorAPI.copyLineUp();
      editorAPI.copyLineDown();
    } finally {
      editorAPI.clearActiveEditorAdapter(adapter.ownerId);
    }

    for (const command of Object.values(commands)) expect(command).toHaveBeenCalledOnce();
  });
});
