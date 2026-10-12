// @vitest-environment jsdom
import { Text } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCodeMirrorPositionResolver } from "../engines/codemirror/position-resolver";
import { fromBufferOffset, toEditorPosition } from "../engines/codemirror/position";
import {
  calculateOffsetFromPosition,
  getAccurateCursorX,
  getLineHeight,
  measureTextWidth,
} from "../services/position";

const fonts = vi.hoisted(() => ({
  ready: true,
  resolveReady: null as null | (() => void),
  measured: [] as string[],
}));

const CHAR_WIDTHS: Record<string, number> = { W: 11.1234, i: 3.3333, " ": 7 };

beforeEach(() => {
  fonts.ready = true;
  fonts.measured = [];
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      check: () => fonts.ready,
      get ready() {
        return new Promise<void>((resolve) => {
          fonts.resolveReady = resolve;
        });
      },
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const context = {
      font: "",
      measureText(char: string) {
        fonts.measured.push(`${context.font}|${char}`);
        return { width: CHAR_WIDTHS[char] ?? 8 };
      },
    };
    return context as never;
  });
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    callback();
    return 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offsets from positions", () => {
  it("adds earlier line lengths and clamps the column to the line", () => {
    const lines = ["abc", "de", "fghij"];
    expect(calculateOffsetFromPosition(0, 2, lines)).toBe(2);
    expect(calculateOffsetFromPosition(1, 10, lines)).toBe(6);
    expect(calculateOffsetFromPosition(2, 3, lines)).toBe(10);
    expect(calculateOffsetFromPosition(9, 3, lines)).toBe(13);
  });

  it("rounds line height up to whole pixels", () => {
    expect(getLineHeight(13)).toBe(Math.ceil(13 * 1.4));
    expect(getLineHeight(14, 1.5)).toBe(21);
  });
});

describe("text measurement", () => {
  it("measures each character with the canvas and rounds the width", () => {
    expect(measureTextWidth("Wi", 14, "JetBrains Mono, monospace")).toBeCloseTo(11.123 + 3.333);
  });

  it("quotes font family names the canvas cannot parse", () => {
    measureTextWidth("i", 12, "Fira Code, 'Already Quoted', ui-monospace, Menlo_2, Weird\"Name");

    expect(fonts.measured[0]).toBe(
      `12px "Fira Code", 'Already Quoted', ui-monospace, Menlo_2, "Weird\\"Name"|i`,
    );
  });

  it("expands tabs to the next tab stop", () => {
    expect(getAccurateCursorX("\tW", 2, 10, "monospace", 4)).toBeCloseTo(28 + 11.123);
    expect(getAccurateCursorX("i\t", 2, 10, "monospace", 0)).toBeCloseTo(3.333 + 7);
    expect(getAccurateCursorX("abc", 99, 10, "monospace")).toBe(24);
  });

  it("reuses cached widths for a ready font", () => {
    measureTextWidth("WW", 16, "Cached Font");
    const measuredBefore = fonts.measured.filter((entry) => entry.endsWith("|W")).length;

    measureTextWidth("WWW", 16, "Cached Font");

    expect(fonts.measured.filter((entry) => entry.endsWith("|W")).length).toBe(measuredBefore);
  });

  it("does not cache widths while the font is still loading", async () => {
    fonts.ready = false;
    measureTextWidth("W", 18, "Loading Font");
    measureTextWidth("W", 18, "Loading Font");
    expect(fonts.measured.filter((entry) => entry === `18px "Loading Font"|W`)).toHaveLength(2);

    fonts.ready = true;
    fonts.resolveReady?.();
    await Promise.resolve();
    measureTextWidth("W", 18, "Loading Font");
    measureTextWidth("W", 18, "Loading Font");
    expect(fonts.measured.filter((entry) => entry === `18px "Loading Font"|W`)).toHaveLength(3);
  });
});

describe("CodeMirror positions", () => {
  it("maps buffer offsets with CRLF line breaks to document positions", () => {
    const doc = Text.of(["one", "two", "three"]);

    expect(fromBufferOffset(doc, 0, "\r\n")).toBe(0);
    expect(fromBufferOffset(doc, 5, "\r\n")).toBe(4);
    expect(fromBufferOffset(doc, 7, "\r\n")).toBe(6);
    expect(fromBufferOffset(doc, 4, "\r\n")).toBe(3);
    expect(fromBufferOffset(doc, 999, "\r\n")).toBe(doc.length);
    expect(fromBufferOffset(doc, 999, "\n")).toBe(doc.length);
    expect(fromBufferOffset(doc, -3, "\n")).toBe(0);

    const position = toEditorPosition(doc, 6, "\r\n");
    expect(fromBufferOffset(doc, position.offset, "\r\n")).toBe(6);
  });

  it("places overlays at the character's coordinates or estimates them", () => {
    const doc = Text.of(["hello", "world"]);
    const view = {
      state: { doc },
      coordsAtPos: vi.fn((position: number) => (position === 8 ? { left: 140 } : null)),
      contentDOM: { getBoundingClientRect: () => ({ left: 100 }) },
      lineBlockAt: (position: number) => ({ top: doc.lineAt(position).number * 20 }),
      defaultCharacterWidth: 8,
    };
    let current: typeof view | null = view;
    const resolve = createCodeMirrorPositionResolver(() => current as never);

    expect(resolve(1, 2)).toEqual({ top: 40, left: 40 });
    expect(resolve(0, 3)).toEqual({ top: 20, left: 24 });

    current = null;
    expect(resolve(0, 0)).toBeNull();
  });
});
