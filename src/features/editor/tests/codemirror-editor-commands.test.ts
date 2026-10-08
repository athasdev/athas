// @vitest-environment jsdom
import { javascript } from "@codemirror/lang-javascript";
import {
  EditorSelection,
  EditorState,
  type Extension,
  type SelectionRange,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { CodeMirrorEditorCommands } from "../engines/codemirror/features/codemirror-editor-commands";
import type { CodeMirrorHost } from "../engines/codemirror/host";
import {
  createCodeMirrorLineCommands,
  fallbackCommentTokens,
} from "../engines/codemirror/editor-commands";
import { isEditorKeyboardTarget } from "@/features/keymaps/services/editor-keyboard-target";

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

let views: EditorView[] = [];

function createView(
  doc: string,
  selection: EditorSelection | SelectionRange,
  extensions: Extension = [],
) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true), extensions],
    }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
  views = [];
});

describe("CodeMirror line commands", () => {
  it("toggles line comments with the language's tokens", () => {
    const view = createView("a\nb", EditorSelection.single(0, 3), [
      javascript(),
      fallbackCommentTokens("python"),
    ]);
    const commands = createCodeMirrorLineCommands(() => view);

    commands.toggleComment();
    expect(view.state.doc.toString()).toBe("// a\n// b");
    commands.toggleComment();
    expect(view.state.doc.toString()).toBe("a\nb");
  });

  it("falls back to the Athas comment token when the language declares none", () => {
    const view = createView("x = 1", EditorSelection.cursor(0), fallbackCommentTokens("python"));

    createCodeMirrorLineCommands(() => view).toggleComment();

    expect(view.state.doc.toString()).toBe("# x = 1");
  });

  it("duplicates, moves, copies and deletes lines at every cursor", () => {
    const view = createView(
      "one\ntwo\nthree",
      EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(9)]),
    );
    const commands = createCodeMirrorLineCommands(() => view);

    commands.duplicateLine();
    expect(view.state.doc.toString()).toBe("one\none\ntwo\nthree\nthree");

    commands.deleteLine();
    expect(view.state.doc.toString()).toBe("one\ntwo\nthree");

    view.dispatch({ selection: EditorSelection.cursor(0) });
    commands.moveLineDown();
    expect(view.state.doc.toString()).toBe("two\none\nthree");

    commands.moveLineUp();
    expect(view.state.doc.toString()).toBe("one\ntwo\nthree");

    const single = createView("a\nb", EditorSelection.cursor(0));
    const singleCommands = createCodeMirrorLineCommands(() => single);
    singleCommands.copyLineUp();
    expect(single.state.doc.toString()).toBe("a\na\nb");
    expect(single.state.selection.main.head).toBe(0);
    singleCommands.copyLineDown();
    expect(single.state.doc.toString()).toBe("a\na\na\nb");
    expect(single.state.selection.main.head).toBe(2);
  });
});

describe("editor keyboard target", () => {
  function shell() {
    const element = document.createElement("div");
    element.dataset.editorEngine = "codemirror";
    document.body.append(element);
    return element;
  }

  it("treats CodeMirror's text as the editor but not its panels or overlay fields", () => {
    const editorShell = shell();
    const view = createView("text", EditorSelection.cursor(0));
    editorShell.append(view.dom);
    const panel = document.createElement("div");
    panel.className = "cm-panels";
    const panelInput = document.createElement("input");
    panel.append(panelInput);
    view.dom.append(panel);
    const overlayInput = document.createElement("input");
    const overlayButton = document.createElement("button");
    editorShell.append(overlayInput, overlayButton);

    expect(isEditorKeyboardTarget(view.contentDOM)).toBe(true);
    expect(isEditorKeyboardTarget(panelInput)).toBe(false);
    expect(isEditorKeyboardTarget(overlayInput)).toBe(false);
    expect(isEditorKeyboardTarget(overlayButton)).toBe(true);

    editorShell.remove();
  });

  it("ignores CodeMirror views outside an Athas editor", () => {
    const view = createView("log output", EditorSelection.cursor(0));

    expect(isEditorKeyboardTarget(view.contentDOM)).toBe(false);
  });
});

describe("select all outside the editor", () => {
  function pressSelectAll(target: EventTarget) {
    const event = new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it("selects the active editor's text while focus is on a non-text element", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const view = createView("hello world", EditorSelection.cursor(0));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const host = {
      view,
      container,
      isActiveSurface: true,
      languageId: null,
    } as unknown as CodeMirrorHost;
    act(() => root.render(createElement(CodeMirrorEditorCommands, { host })));

    const input = document.createElement("input");
    document.body.append(input);
    expect(pressSelectAll(input).defaultPrevented).toBe(false);
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 0 });

    const button = document.createElement("button");
    document.body.append(button);
    expect(pressSelectAll(button).defaultPrevented).toBe(true);
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 11 });

    act(() => root.unmount());
    input.remove();
    button.remove();
    container.remove();
  });
});
