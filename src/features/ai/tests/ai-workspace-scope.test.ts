import { describe, expect, it } from "vite-plus/test";
import {
  filterChatsByWorkspace,
  getChatWorkspacePath,
  isChatInWorkspace,
} from "@/features/ai/lib/ai-workspace-scope";

const chat = (id: string, workspacePath?: string | null) => ({
  id,
  workspacePath,
});

describe("AI workspace scope", () => {
  it("normalizes missing chat workspace to the no-workspace scope", () => {
    expect(getChatWorkspacePath(chat("global"))).toBeNull();
    expect(isChatInWorkspace(chat("global"), null)).toBe(true);
    expect(isChatInWorkspace(chat("global"), "/workspace-a")).toBe(false);
  });

  it("filters chats to the active workspace", () => {
    expect(
      filterChatsByWorkspace(
        [chat("a", "/workspace-a"), chat("b", "/workspace-b"), chat("global", null)],
        "/workspace-a",
      ).map((item) => item.id),
    ).toEqual(["a"]);
  });
});
