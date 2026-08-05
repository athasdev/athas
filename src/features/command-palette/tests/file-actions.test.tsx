import { describe, expect, it, vi } from "vite-plus/test";
import { createFileActions } from "../constants/file-actions";

describe("file command palette actions", () => {
  it("opens a new rich Markdown document", () => {
    const onClose = vi.fn();
    const openMarkdownDocument = vi.fn();
    const actions = createFileActions({
      activeBufferId: null,
      closeBuffer: vi.fn(),
      switchToNextBuffer: vi.fn(),
      switchToPreviousBuffer: vi.fn(),
      reopenClosedTab: vi.fn(async () => {}),
      openMarkdownDocument,
      onClose,
    });

    const action = actions.find((candidate) => candidate.id === "file-new-document");
    expect(action?.label).toBe("File: New Document");

    action?.action();

    expect(onClose).toHaveBeenCalledOnce();
    expect(openMarkdownDocument).toHaveBeenCalledOnce();
  });
});
