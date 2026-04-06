import { describe, expect, it } from "vite-plus/test";
import { getChatTitleFromSessionInfo } from "./acp-session-info";

describe("getChatTitleFromSessionInfo", () => {
  it("returns trimmed title updates", () => {
    expect(getChatTitleFromSessionInfo("New Chat", "  Refactor parser  ")).toBe("Refactor parser");
  });

  it("ignores empty or unchanged titles", () => {
    expect(getChatTitleFromSessionInfo("New Chat", "   ")).toBeNull();
    expect(getChatTitleFromSessionInfo("Refactor parser", "Refactor parser")).toBeNull();
    expect(getChatTitleFromSessionInfo("Refactor parser", null)).toBeNull();
  });
});
