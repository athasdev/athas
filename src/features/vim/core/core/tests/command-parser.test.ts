import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(),
    onDragDropEvent: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(),
  }),
}));

import { getCommandParseStatus, getEffectiveCount, parseVimCommand } from "../command-parser";

describe("parseVimCommand", () => {
  it("parses simple motion", () => {
    const result = parseVimCommand(["j"]);
    expect(result).toEqual({ motion: "j" });
  });

  it("parses motion with count", () => {
    const result = parseVimCommand(["3", "j"]);
    expect(result).toEqual({ count: 3, motion: "j" });
  });

  it("parses operator + motion", () => {
    const result = parseVimCommand(["d", "w"]);
    expect(result).toEqual({ operator: "d", motion: "w" });
  });

  it("parses count + operator + motion", () => {
    const result = parseVimCommand(["2", "d", "w"]);
    expect(result).toEqual({ count: 2, operator: "d", motion: "w" });
  });

  it("parses operator + count + motion", () => {
    const result = parseVimCommand(["d", "3", "w"]);
    expect(result).toEqual({ operator: "d", motion: "w", count: 3 });
  });

  it("parses doubled operator as linewise", () => {
    const result = parseVimCommand(["d", "d"]);
    expect(result).toEqual({ operator: "d", motion: "d", count: undefined });
  });

  it("parses count + doubled operator", () => {
    const result = parseVimCommand(["3", "d", "d"]);
    expect(result).toEqual({ count: 3, operator: "d", motion: "d" });
  });

  it("parses text object", () => {
    const result = parseVimCommand(["d", "i", "w"]);
    expect(result).toEqual({
      operator: "d",
      textObject: { mode: "inner", object: "w" },
    });
  });

  it("parses action", () => {
    const result = parseVimCommand(["p"]);
    expect(result).toEqual({ action: "p" });
  });

  it("parses action with count", () => {
    const result = parseVimCommand(["3", "p"]);
    expect(result).toEqual({ count: 3, action: "p" });
  });

  it("parses multi-key operator", () => {
    const result = parseVimCommand(["g", "u", "w"]);
    expect(result).toEqual({ operator: "gu", motion: "w" });
  });

  it("parses gg motion", () => {
    const result = parseVimCommand(["g", "g"]);
    expect(result).toEqual({ motion: "gg" });
  });

  it("parses count + gg motion", () => {
    const result = parseVimCommand(["5", "g", "g"]);
    expect(result).toEqual({ count: 5, motion: "gg" });
  });

  it("returns null for empty input", () => {
    const result = parseVimCommand([]);
    expect(result).toBeNull();
  });

  it("returns null for invalid keys", () => {
    const result = parseVimCommand(["z", "z", "z"]);
    expect(result).toBeNull();
  });
});

describe("getEffectiveCount", () => {
  it("defaults to 1 when no count", () => {
    expect(getEffectiveCount({ motion: "j" })).toBe(1);
  });

  it("returns the count when present", () => {
    expect(getEffectiveCount({ count: 5, motion: "j" })).toBe(5);
  });
});

describe("getCommandParseStatus", () => {
  it("returns incomplete for empty buffer", () => {
    expect(getCommandParseStatus([])).toBe("incomplete");
  });

  it("returns complete for simple motion", () => {
    expect(getCommandParseStatus(["j"])).toBe("complete");
  });

  it("returns incomplete for partial multi-key motion", () => {
    expect(getCommandParseStatus(["g"])).toBe("incomplete");
  });

  it("returns complete for gg", () => {
    expect(getCommandParseStatus(["g", "g"])).toBe("complete");
  });

  it("returns incomplete for operator alone", () => {
    expect(getCommandParseStatus(["d"])).toBe("incomplete");
  });

  it("returns complete for operator + motion", () => {
    expect(getCommandParseStatus(["d", "w"])).toBe("complete");
  });

  it("returns invalid for unknown sequence", () => {
    expect(getCommandParseStatus(["z", "q"])).toBe("invalid");
  });
});
