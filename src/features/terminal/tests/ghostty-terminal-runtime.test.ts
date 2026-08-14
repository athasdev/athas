import { describe, expect, it } from "vite-plus/test";
import type { TerminalFrontend } from "../types/terminal-frontend.types";
import {
  findGhosttyTerminalMatches,
  serializeTerminalBuffer,
} from "../lib/ghostty-terminal-runtime";

function createBufferSource(lines: string[]): Pick<TerminalFrontend, "buffer"> {
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (index) => {
          const line = lines[index] ?? "";
          return {
            translateToString: (trimRight = false) => (trimRight ? line.trimEnd() : line),
          };
        },
      },
    },
  };
}

describe("Ghostty terminal runtime adapters", () => {
  it("finds terminal buffer matches with xterm-compatible search options", () => {
    const terminal = createBufferSource(["Alpha beta alpha", "alphabet", "BETA"]);

    expect(
      findGhosttyTerminalMatches(terminal, "alpha", {
        caseSensitive: false,
        wholeWord: true,
      }),
    ).toEqual([
      { column: 0, length: 5, row: 0 },
      { column: 11, length: 5, row: 0 },
    ]);
    expect(
      findGhosttyTerminalMatches(terminal, "B.TA", {
        caseSensitive: true,
        regex: true,
      }),
    ).toEqual([{ column: 0, length: 4, row: 2 }]);
  });

  it("serializes visible and scrollback lines without trailing blank rows", () => {
    const terminal = createBufferSource(["first  ", "second", "", ""]);

    expect(serializeTerminalBuffer(terminal)).toBe("first\nsecond");
  });
});
