// @vitest-environment jsdom
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vite-plus/test";
import { athasSyntaxHighlighting } from "../engines/codemirror/theme";

describe("CodeMirror syntax highlighting", () => {
  // A second copy of @lezer/highlight gives the parsers and the theme different tag objects, and
  // nothing gets colored without any error.
  it("colors tokens from a Lezer language with the Athas highlight style", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "const answer = 42;",
        extensions: [javascript(), athasSyntaxHighlighting(false)],
      }),
    });

    const styled = [...view.contentDOM.querySelectorAll(".cm-line span")].filter(
      (span) => span.className !== "",
    );
    expect(styled.map((span) => span.textContent)).toEqual(expect.arrayContaining(["const", "42"]));
    view.destroy();
  });
});
