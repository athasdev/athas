// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { IntelligenceCompletionRequest } from "@/features/ai/intelligence/services/intelligence-completion-service";

const mocks = vi.hoisted(() => ({ canRequest: true }));

vi.mock("@/features/ai/intelligence/services/intelligence-completion-service", () => ({
  canRequestIntelligenceCompletion: () => mocks.canRequest,
  registerIntelligenceCompletionResume: vi.fn(),
  requestIntelligenceCompletion: vi.fn(async () => null),
  INTELLIGENCE_COMPLETION_DEBOUNCE_MS: 350,
  INTELLIGENCE_COMPLETION_PREFIX_CHARS: 12000,
  INTELLIGENCE_COMPLETION_SUFFIX_CHARS: 4000,
}));

const {
  acceptInlineSuggestion,
  acceptInlineSuggestionWord,
  dismissInlineSuggestion,
  inlineCompletionExtension,
  inlineSuggestionField,
  nextSuggestionWord,
  setInlineSuggestion,
} = await import("../engines/codemirror/features/ai-inline-completion");

let view: EditorView | null = null;
let request = vi.fn<(request: IntelligenceCompletionRequest) => Promise<string | null>>();

function createView(doc: string, cursor = doc.length) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: inlineCompletionExtension({
        filePath: "/repo/a.ts",
        languageId: "typescript",
        getSeparator: () => "\n",
        request,
        debounceMs: 5,
      }),
    }),
    parent: document.body,
  });
  vi.spyOn(view, "hasFocus", "get").mockReturnValue(true);
  return view;
}

function typeText(editor: EditorView, text: string) {
  const at = editor.state.selection.main.head;
  editor.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: "input.type",
  });
}

function ghostText(editor: EditorView) {
  return editor.dom.querySelector(".cm-athas-ghostText")?.textContent ?? null;
}

beforeEach(() => {
  mocks.canRequest = true;
  request = vi.fn(async () => "log(value);\n}");
});

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("CodeMirror AI inline completion", () => {
  it("asks for a completion after typing pauses and shows it as ghost text", async () => {
    const editor = createView("function f(value) {\n  console.");
    typeText(editor, "l");
    expect(request).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ghostText(editor)).toBe("log(value);\n}"));

    const [call] = request.mock.calls[0];
    expect(call).toMatchObject({
      filePath: "/repo/a.ts",
      languageId: "typescript",
      beforeSelection: "function f(value) {\n  console.l",
      afterSelection: "",
      line: 2,
    });
  });

  it("keeps the rest of the suggestion while the user types it, and drops it otherwise", () => {
    const editor = createView("con");
    editor.dispatch({ effects: setInlineSuggestion.of({ pos: 3, text: "sole.log()" }) });
    typeText(editor, "so");
    expect(editor.state.field(inlineSuggestionField)).toEqual({ pos: 5, text: "le.log()" });
    typeText(editor, "x");
    expect(editor.state.field(inlineSuggestionField)).toBeNull();
  });

  it("drops the suggestion when the cursor moves away", () => {
    const editor = createView("abc");
    editor.dispatch({ effects: setInlineSuggestion.of({ pos: 3, text: "def" }) });
    editor.dispatch({ selection: { anchor: 1 } });
    expect(editor.state.field(inlineSuggestionField)).toBeNull();
  });

  it("accepts the whole suggestion or its next word, and dismisses it", () => {
    const editor = createView("const ");
    editor.dispatch({ effects: setInlineSuggestion.of({ pos: 6, text: "total = sum(a);" }) });
    expect(nextSuggestionWord("total = sum(a);")).toBe("total");
    expect(acceptInlineSuggestionWord(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("const total");
    expect(editor.state.field(inlineSuggestionField)).toEqual({ pos: 11, text: " = sum(a);" });

    expect(acceptInlineSuggestion(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("const total = sum(a);");
    expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
    expect(editor.state.field(inlineSuggestionField)).toBeNull();
    expect(acceptInlineSuggestion(editor)).toBe(false);

    editor.dispatch({ effects: setInlineSuggestion.of({ pos: 21, text: "\n" }) });
    expect(dismissInlineSuggestion(editor)).toBe(true);
    expect(editor.state.field(inlineSuggestionField)).toBeNull();
  });

  it("accepts with Tab and dismisses with Escape from the keyboard", () => {
    const editor = createView("a");
    editor.dispatch({ effects: setInlineSuggestion.of({ pos: 1, text: "bc" }) });
    editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(editor.state.doc.toString()).toBe("abc");

    editor.dispatch({ effects: setInlineSuggestion.of({ pos: 3, text: "d" }) });
    editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(editor.state.field(inlineSuggestionField)).toBeNull();
    expect(editor.state.doc.toString()).toBe("abc");
  });

  it("discards a completion that arrives after the text moved on", async () => {
    let resolve: (value: string) => void = () => {};
    request = vi.fn(() => new Promise<string | null>((done) => (resolve = done)));
    const editor = createView("let x");
    typeText(editor, " ");
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    const { signal } = request.mock.calls[0][0];
    typeText(editor, "=");
    expect(signal.aborted).toBe(true);
    resolve("= 1;");
    await Promise.resolve();
    expect(editor.state.field(inlineSuggestionField)).toBeNull();
  });

  it("does not ask when Tab autocomplete is off or the prefix is blank", async () => {
    mocks.canRequest = false;
    const editor = createView("x");
    typeText(editor, "y");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).not.toHaveBeenCalled();

    mocks.canRequest = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "" } });
    typeText(editor, " ");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).not.toHaveBeenCalled();
  });
});
