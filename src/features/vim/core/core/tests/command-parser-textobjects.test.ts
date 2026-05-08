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

import { parseVimCommand } from "../command-parser";

describe("text object commands", () => {
  it("parses ciw (change inner word)", () => {
    const result = parseVimCommand(["c", "i", "w"]);
    expect(result).toEqual({
      operator: "c",
      textObject: { mode: "inner", object: "w" },
    });
  });

  it("parses caw (change around word)", () => {
    const result = parseVimCommand(["c", "a", "w"]);
    expect(result).toEqual({
      operator: "c",
      textObject: { mode: "around", object: "w" },
    });
  });

  it("parses di( (delete inner parens)", () => {
    const result = parseVimCommand(["d", "i", "("]);
    expect(result).toEqual({
      operator: "d",
      textObject: { mode: "inner", object: "(" },
    });
  });

  it("parses 2ciw (count + change inner word)", () => {
    const result = parseVimCommand(["2", "c", "i", "w"]);
    expect(result).toEqual({
      count: 2,
      operator: "c",
      textObject: { mode: "inner", object: "w" },
    });
  });
});

describe("find char commands", () => {
  it.todo("parses df; (delete find semicolon) — f/F/t/T not in motion registry", () => {
    const result = parseVimCommand(["d", "f", ";"]);
    expect(result).toEqual({
      operator: "d",
      motion: "f;",
    });
  });

  it.todo("parses dt; (delete to semicolon) — t not in motion registry", () => {
    const result = parseVimCommand(["d", "t", ";"]);
    expect(result).toEqual({
      operator: "d",
      motion: "t;",
    });
  });
});
