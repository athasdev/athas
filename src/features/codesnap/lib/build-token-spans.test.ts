import { describe, expect, test } from "vite-plus/test";
import { buildTokenSpans } from "./build-token-spans";

type Tok = { start: number; end: number; class_name: string };

describe("buildTokenSpans", () => {
  test("splits a single-line input into one line of spans", () => {
    const text = "fn main";
    const tokens: Tok[] = [
      { start: 0, end: 2, class_name: "token-keyword" },
      { start: 2, end: 3, class_name: "token-default" },
      { start: 3, end: 7, class_name: "token-function" },
    ];
    const lines = buildTokenSpans(text, tokens);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { text: "fn", className: "token-keyword" },
      { text: " ", className: "token-default" },
      { text: "main", className: "token-function" },
    ]);
  });

  test("splits on \\n into multiple lines", () => {
    const text = "a\nb\nc";
    const tokens: Tok[] = [{ start: 0, end: 5, class_name: "token-default" }];
    const lines = buildTokenSpans(text, tokens);
    expect(lines).toHaveLength(3);
    expect(lines[0][0].text).toBe("a");
    expect(lines[1][0].text).toBe("b");
    expect(lines[2][0].text).toBe("c");
  });

  test("tokens spanning a newline are split across lines while preserving className", () => {
    const text = "ab\ncd";
    const tokens: Tok[] = [{ start: 0, end: 5, class_name: "token-string" }];
    const lines = buildTokenSpans(text, tokens);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([{ text: "ab", className: "token-string" }]);
    expect(lines[1]).toEqual([{ text: "cd", className: "token-string" }]);
  });

  test("preserves multi-byte characters (emoji) without splitting graphemes", () => {
    const text = "// 🎉 ok";
    const tokens: Tok[] = [{ start: 0, end: text.length, class_name: "token-comment" }];
    const lines = buildTokenSpans(text, tokens);
    expect(lines[0][0].text).toBe("// 🎉 ok");
  });

  test("empty input returns a single empty line", () => {
    expect(buildTokenSpans("", [])).toEqual([[]]);
  });

  test("trailing newline produces a trailing empty line", () => {
    const text = "x\n";
    const tokens: Tok[] = [{ start: 0, end: 1, class_name: "token-default" }];
    const lines = buildTokenSpans(text, tokens);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual([]);
  });

  test("gaps in token coverage are filled with token-text", () => {
    const text = "ab cd";
    const tokens: Tok[] = [
      { start: 0, end: 2, class_name: "token-keyword" },
      { start: 3, end: 5, class_name: "token-function" },
    ];
    const lines = buildTokenSpans(text, tokens);
    expect(lines[0]).toEqual([
      { text: "ab", className: "token-keyword" },
      { text: " ", className: "token-text" },
      { text: "cd", className: "token-function" },
    ]);
  });

  test("normalizes CRLF input so spans do not contain trailing \\r", () => {
    const text = "ab\r\ncd";
    const tokens: Tok[] = [{ start: 0, end: text.length, class_name: "token-string" }];
    const lines = buildTokenSpans(text, tokens);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([{ text: "ab", className: "token-string" }]);
    expect(lines[1]).toEqual([{ text: "cd", className: "token-string" }]);
  });
});
