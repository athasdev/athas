// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { buildTerminalFontFamily, resolveTerminalFont } from "../utils/resolve-font";

const fonts = vi.hoisted(() => ({
  load: vi.fn(),
  check: vi.fn(),
}));

beforeEach(() => {
  fonts.load.mockReset().mockResolvedValue([]);
  fonts.check.mockReset().mockReturnValue(true);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: fonts.load, check: fonts.check, ready: Promise.resolve() },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveTerminalFont", () => {
  it("keeps the requested font once its regular and bold faces load", async () => {
    await expect(resolveTerminalFont("Fira Code, monospace", 13)).resolves.toEqual({
      fontFamily: buildTerminalFontFamily("Fira Code, monospace"),
    });
    expect(fonts.load.mock.calls.map(([face]) => face)).toEqual([
      '13px "Fira Code"',
      '700 13px "Fira Code"',
    ]);
  });

  it("falls back to the platform monospace font when loading fails", async () => {
    fonts.load.mockRejectedValueOnce(new Error("network"));

    const { fontFamily } = await resolveTerminalFont("Missing Mono", 13);

    expect(fontFamily).not.toContain("Missing Mono");
    expect(fontFamily).toMatch(/monospace$/);
  });

  it("falls back when a face loads but is not usable", async () => {
    fonts.check.mockImplementation((face: string) => !face.startsWith("700"));

    const { fontFamily } = await resolveTerminalFont("Half Font", 12);

    expect(fontFamily).not.toContain("Half Font");
  });

  it("falls back when no font is named", async () => {
    const { fontFamily } = await resolveTerminalFont("  ", 12);
    expect(fontFamily).toMatch(/monospace$/);
    expect(fonts.load).not.toHaveBeenCalled();
  });
});
