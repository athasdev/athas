// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CodeMirrorHost } from "../engines/codemirror/host";

const mocks = vi.hoisted(() => ({
  keepAgentHunk: vi.fn(async () => {}),
  rejectAgentHunk: vi.fn(async () => {}),
  setContext: vi.fn(),
  showToast: vi.fn(),
  chats: [] as Array<{ id: string; title: string }>,
}));

vi.mock("@/features/ai/services/agent-edits-service", () => ({
  keepAgentHunk: mocks.keepAgentHunk,
  rejectAgentHunk: mocks.rejectAgentHunk,
}));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: { getState: () => ({ chats: mocks.chats }) },
}));
vi.mock("@/features/keymaps/stores/keymaps.store", () => ({
  useKeymapStore: { getState: () => ({ actions: { setContext: mocks.setContext } }) },
}));
vi.mock("@/features/layout/contexts/toast-context", () => ({ showToast: mocks.showToast }));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { useAgentEditsStore } = await import("@/features/ai/stores/agent-edits.store");
const { CodeMirrorAgentEdits } =
  await import("../engines/codemirror/features/codemirror-agent-edits");
const { keepAgentHunkAtCursor, rejectAgentHunkAtCursor } =
  await import("../agent-edits/agent-hunk-actions");

const PATH = "/repo/a.ts";
let view: EditorView;
let root: Root;
let reactContainer: HTMLDivElement;

function setEntry(chatId: string, baseline: string, current: string) {
  useAgentEditsStore.getState().actions.setEntry(chatId, PATH, {
    path: PATH,
    baseline,
    current,
    created: false,
    revision: 1,
  } as never);
}

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc }) });
  const host: CodeMirrorHost = {
    view,
    container: parent,
    bufferId: "buffer-1",
    filePath: PATH,
    languageId: "typescript",
    viewStateKey: null,
    isActiveSurface: true,
    isReadOnly: false,
    isVirtual: false,
    getSeparator: () => "\n",
    applyHistory: () => true,
  };
  reactContainer = document.createElement("div");
  document.body.append(reactContainer);
  root = createRoot(reactContainer);
  act(() => root.render(<CodeMirrorAgentEdits host={host} />));
}

const addedLines = () =>
  [...view.contentDOM.querySelectorAll(".cm-agent-edit-added-line")].map(
    (line) => line.textContent,
  );
const removedLines = () =>
  [...view.contentDOM.querySelectorAll(".cm-agent-edit-removed-line")].map(
    (line) => line.textContent,
  );
const lensButtons = () => [
  ...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-agent-edit-lens-action"),
];

describe("CodeMirror agent edits", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    mocks.chats = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    reactContainer.remove();
    view.dom.parentElement?.remove();
    view.destroy();
    for (const chatId of Object.keys(useAgentEditsStore.getState().byChat)) {
      useAgentEditsStore.getState().actions.forgetChat(chatId);
    }
    vi.useRealTimers();
  });

  it("highlights added lines and shows replaced lines above them with Keep and Undo", () => {
    setEntry("chat-1", "one\ntwo\nthree", "one\nTWO\nthree");
    mount("one\nTWO\nthree");

    expect(addedLines()).toEqual(["TWO"]);
    expect(removedLines()).toEqual(["two"]);
    expect(lensButtons().map((button) => button.textContent)).toEqual(["Keep", "Undo"]);

    act(() => lensButtons()[0].click());
    expect(mocks.keepAgentHunk).toHaveBeenCalledWith(
      "chat-1",
      PATH,
      expect.objectContaining({ currentStart: 1, currentLines: ["TWO"] }),
    );
    act(() => lensButtons()[1].click());
    expect(mocks.rejectAgentHunk).toHaveBeenCalledTimes(1);
  });

  it("draws nothing while the editor text differs from what the agent wrote", () => {
    setEntry("chat-1", "one\ntwo", "one\nTWO");
    mount("one\nTWO edited");

    expect(addedLines()).toEqual([]);
    expect(lensButtons()).toHaveLength(0);
  });

  it("redraws when the store changes", () => {
    mount("one\nTWO");
    expect(lensButtons()).toHaveLength(0);

    act(() => setEntry("chat-1", "one\ntwo", "one\nTWO"));
    act(() => vi.advanceTimersByTime(60));

    expect(addedLines()).toEqual(["TWO"]);
  });

  it("names the chat on its actions when several chats edited the file", () => {
    mocks.chats = [
      { id: "chat-1", title: "First" },
      { id: "chat-2", title: "Second" },
    ];
    setEntry("chat-1", "a\nb\nc", "a\nb\nc!");
    setEntry("chat-2", "a\nb\nc", "a\nb\nc!");
    mount("a\nb\nc!");

    expect(lensButtons().map((button) => button.textContent)).toEqual([
      "Keep (First)",
      "Undo (First)",
      "Keep (Second)",
      "Undo (Second)",
    ]);
  });

  it("keeps or rejects the hunk at the cursor of the focused editor", async () => {
    setEntry("chat-1", "one\ntwo\nthree", "one\nTWO\nthree");
    mount("one\nTWO\nthree");
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 5 } });
    });
    view.contentDOM.dispatchEvent(new FocusEvent("focus"));

    expect(await keepAgentHunkAtCursor()).toBe(true);
    expect(mocks.keepAgentHunk).toHaveBeenCalledTimes(1);
    expect(await rejectAgentHunkAtCursor()).toBe(true);
    expect(mocks.rejectAgentHunk).toHaveBeenCalledTimes(1);
    expect(mocks.setContext).toHaveBeenCalledWith("agentEditHunks", true);
  });

  it("says so when the focused editor has no agent change", async () => {
    mount("plain");
    act(() => view.focus());
    view.contentDOM.dispatchEvent(new FocusEvent("focus"));

    expect(await keepAgentHunkAtCursor()).toBe(false);
    expect(mocks.showToast).toHaveBeenCalled();
  });
});
