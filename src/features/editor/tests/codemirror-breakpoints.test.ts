// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { DebugBreakpoint } from "@/features/debugger/types/debugger.types";
import {
  BREAKPOINT_GUTTER_CLASS,
  breakpointGutter,
  hasBreakpointMarker,
  setBreakpoints,
  setHoveredBreakpointLine,
} from "../engines/codemirror/features/breakpoints";

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

let view: EditorView | null = null;

function createView(doc: string, onToggle = vi.fn()) {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [lineNumbers(), breakpointGutter(onToggle)] }),
  });
  return view;
}

function breakpoint(line: number, overrides: Partial<DebugBreakpoint> = {}): DebugBreakpoint {
  return {
    id: `bp-${line}`,
    filePath: "/repo/a.ts",
    line,
    enabled: true,
    createdAt: 0,
    ...overrides,
  };
}

/** The visible markers; the gutter's width spacer is a hidden marker too. */
const markers = (editor: EditorView) =>
  [...editor.dom.querySelectorAll<HTMLElement>(`.${BREAKPOINT_GUTTER_CLASS} .cm-athas-breakpoint`)]
    .filter((marker) => marker.parentElement?.style.visibility !== "hidden")
    .map((marker) => ({ className: marker.className, title: marker.title }));

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
});

describe("CodeMirror breakpoint gutter", () => {
  it("puts the gutter before the line numbers", () => {
    const editor = createView("a\nb");
    const gutters = [...editor.dom.querySelectorAll(".cm-gutter")];
    expect(gutters[0].classList.contains(BREAKPOINT_GUTTER_CLASS)).toBe(true);
  });

  it("draws set, disabled and unverified breakpoints with their messages", () => {
    const editor = createView("a\nb\nc\nd");
    editor.dispatch({
      effects: setBreakpoints.of([
        breakpoint(0),
        breakpoint(1, { enabled: false }),
        breakpoint(2, { verified: false, message: "Not bound" }),
        breakpoint(9),
      ]),
    });

    expect(markers(editor)).toEqual([
      { className: "cm-athas-breakpoint", title: "Breakpoint" },
      {
        className: "cm-athas-breakpoint cm-athas-breakpoint-disabled",
        title: "Disabled breakpoint",
      },
      { className: "cm-athas-breakpoint cm-athas-breakpoint-unverified", title: "Not bound" },
    ]);
  });

  it("previews a breakpoint on the hovered line unless one is already there", () => {
    const editor = createView("a\nb\nc");
    editor.dispatch({ effects: setBreakpoints.of([breakpoint(0)]) });

    editor.dispatch({ effects: setHoveredBreakpointLine.of(1) });
    expect(markers(editor).map((marker) => marker.className)).toEqual([
      "cm-athas-breakpoint",
      "cm-athas-breakpoint cm-athas-breakpoint-preview",
    ]);

    editor.dispatch({ effects: setHoveredBreakpointLine.of(0) });
    expect(markers(editor).map((marker) => marker.className)).toEqual(["cm-athas-breakpoint"]);
  });

  it("keeps markers on their lines as text is inserted above", () => {
    const editor = createView("a\nb\nc");
    editor.dispatch({ effects: setBreakpoints.of([breakpoint(1)]) });
    editor.dispatch({ changes: { from: 0, insert: "new\n" } });

    expect(hasBreakpointMarker(editor, 1)).toBe(false);
    expect(hasBreakpointMarker(editor, 2)).toBe(true);
  });

  it("toggles the clicked line's breakpoint with a left click", () => {
    const onToggle = vi.fn();
    const editor = createView("a\nb\nc", onToggle);
    const gutter = editor.dom.querySelector(`.${BREAKPOINT_GUTTER_CLASS}`)!;

    gutter.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2, clientY: 0 }));
    expect(onToggle).not.toHaveBeenCalled();

    gutter.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientY: 0 }));
    expect(onToggle).toHaveBeenCalledWith(0);
  });
});
