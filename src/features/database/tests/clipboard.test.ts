import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { formatDatabaseClipboardValue, writeDatabaseClipboardText } from "../utils/clipboard";

describe("database clipboard helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("formats nullish and object values for clipboard copy", () => {
    expect(formatDatabaseClipboardValue(null)).toBe("NULL");
    expect(formatDatabaseClipboardValue({ name: "Ada" })).toBe('{\n  "name": "Ada"\n}');
  });

  it("falls back when object values cannot be JSON serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(formatDatabaseClipboardValue(circular)).toBe("[object Object]");
    expect(formatDatabaseClipboardValue({ id: BigInt(1) })).toBe("[object Object]");
  });

  it("writes clipboard text when the clipboard API is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(writeDatabaseClipboardText("select 1")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("select 1");
  });

  it("returns false instead of throwing when clipboard writes fail", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    await expect(writeDatabaseClipboardText("select 1")).resolves.toBe(false);

    vi.stubGlobal("navigator", {});
    await expect(writeDatabaseClipboardText("select 1")).resolves.toBe(false);
  });
});
