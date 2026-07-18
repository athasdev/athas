import { describe, expect, it } from "vite-plus/test";
import { getChatTitleFromSessionInfo } from "../lib/acp-session-info";

describe("getChatTitleFromSessionInfo", () => {
  it("returns trimmed title updates", () => {
    expect(getChatTitleFromSessionInfo("New Session", "  Refactor parser  ")).toBe(
      "Refactor parser",
    );
  });

  it("ignores empty or unchanged titles", () => {
    expect(getChatTitleFromSessionInfo("New Session", "   ")).toBeNull();
    expect(getChatTitleFromSessionInfo("Refactor parser", "Refactor parser")).toBeNull();
    expect(getChatTitleFromSessionInfo("Refactor parser", null)).toBeNull();
  });
});
