// @vitest-environment jsdom
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CodeMirrorHost } from "../engines/codemirror/host";

const mocks = vi.hoisted(() => ({
  vimMode: true,
  parseAndExecuteVimCommand: vi.fn(async () => true),
}));

vi.mock("@/features/settings/stores/settings.store", () => {
  const getState = () => ({
    settings: { vimMode: mocks.vimMode },
    actions: { updateSetting: vi.fn() },
  });
  return {
    useSettingsStore: Object.assign(
      (selector: (value: unknown) => unknown) => selector(getState()),
      { getState },
    ),
  };
});
vi.mock("@/features/vim/stores/vim-commands", () => ({
  parseAndExecuteVimCommand: mocks.parseAndExecuteVimCommand,
  vimCommands: [
    { name: "write", aliases: ["w"], description: "", execute: vi.fn() },
    { name: "quit!", aliases: ["q!"], description: "", execute: vi.fn() },
    { name: "quit", aliases: ["q"], description: "", execute: vi.fn() },
  ],
}));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { useVimStore } = await import("@/features/vim/stores/vim.store");
const { athasVim, registerAthasVimCommands, setVimHistoryHandler, toAthasExInput, toVimStoreMode } =
  await import("../engines/codemirror/vim");
const { CodeMirrorVim } = await import("../engines/codemirror/features/codemirror-vim");

let views: EditorView[] = [];

function createView(doc: string, extensions: Extension = []) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions }) });
  views.push(view);
  return view;
}

function cm(view: EditorView) {
  const instance = getCM(view);
  if (!instance) throw new Error("vim is not running in the view");
  return instance;
}

function pressKey(view: EditorView, key: string) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  for (const view of views) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
  views = [];
});

describe("vim helpers", () => {
  it("maps vim modes onto the Athas vim store modes", () => {
    expect(toVimStoreMode("insert")).toBe("insert");
    expect(toVimStoreMode("replace")).toBe("insert");
    expect(toVimStoreMode("visual")).toBe("visual");
    expect(toVimStoreMode("normal")).toBe("normal");
    expect(toVimStoreMode(undefined)).toBe("normal");
  });

  it("joins a leading bang back onto the ex command name", () => {
    expect(toAthasExInput("w")).toBe("w");
    expect(toAthasExInput("e", " src/a.ts ")).toBe("e src/a.ts");
    expect(toAthasExInput("q", "!")).toBe("q!");
    expect(toAthasExInput("e", "! a.ts")).toBe("e! a.ts");
  });
});

describe("athasVim", () => {
  it("reports mode changes", () => {
    const onModeChange = vi.fn();
    const view = createView("hello", athasVim(onModeChange));

    Vim.handleKey(cm(view), "i", "user");
    expect(onModeChange).toHaveBeenLastCalledWith("insert");
    Vim.handleKey(cm(view), "<Esc>", "user");
    expect(onModeChange).toHaveBeenLastCalledWith("normal");
    Vim.handleKey(cm(view), "v", "user");
    expect(onModeChange).toHaveBeenLastCalledWith("visual");
  });

  it("handles keys before the editor's other keymaps", () => {
    const other = vi.fn(() => true);
    const view = createView("hello", [keymap.of([{ key: "x", run: other }]), athasVim(vi.fn())]);

    pressKey(view, "x");

    expect(other).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("ello");
  });

  it("runs undo and redo through the Athas buffer history", async () => {
    await registerAthasVimCommands();
    const history = vi.fn(() => true);
    const view = createView("hello", athasVim(vi.fn()));
    setVimHistoryHandler(view, history);

    Vim.handleKey(cm(view), "u", "user");
    Vim.handleKey(cm(view), "<C-r>", "user");
    Vim.handleEx(cm(view) as never, "undo");
    Vim.handleEx(cm(view) as never, "redo");

    expect(history.mock.calls).toEqual([["undo"], ["redo"], ["undo"], ["redo"]]);
  });

  it("runs Athas ex commands", async () => {
    await registerAthasVimCommands();
    const view = createView("hello", athasVim(vi.fn()));
    mocks.parseAndExecuteVimCommand.mockClear();

    Vim.handleEx(cm(view) as never, "w");
    Vim.handleEx(cm(view) as never, "q!");

    expect(mocks.parseAndExecuteVimCommand.mock.calls).toEqual([["w"], ["q!"]]);
  });
});

describe("CodeMirrorVim", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.vimMode = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function host(view: EditorView, overrides: Partial<CodeMirrorHost> = {}): CodeMirrorHost {
    return {
      view,
      container,
      bufferId: "buffer-1",
      filePath: "/repo/a.ts",
      languageId: "typescript",
      viewStateKey: null,
      isActiveSurface: true,
      isReadOnly: false,
      isVirtual: false,
      getSeparator: () => "\n",
      applyHistory: vi.fn(() => true),
      ...overrides,
    };
  }

  it("runs vim in the editor and keeps the vim store mode in step", () => {
    const view = createView("hello");
    useVimStore.getState().actions.setMode("insert");

    act(() => root.render(<CodeMirrorVim host={host(view)} />));

    expect(getCM(view)).not.toBeNull();
    expect(useVimStore.getState().mode).toBe("normal");
    act(() => {
      Vim.handleKey(cm(view), "i", "user");
    });
    expect(useVimStore.getState().mode).toBe("insert");

    act(() => root.render(null));
    expect(getCM(view)).toBeNull();
    expect(useVimStore.getState().mode).toBe("normal");
  });

  it("sends vim undo to the host history", () => {
    const view = createView("hello");
    const applyHistory = vi.fn(() => true);

    act(() => root.render(<CodeMirrorVim host={host(view, { applyHistory })} />));
    Vim.handleKey(cm(view), "u", "user");

    expect(applyHistory).toHaveBeenCalledWith("undo");
  });

  it("stays off for read-only editors and when the setting is off", () => {
    const readOnlyView = createView("hello");
    act(() => root.render(<CodeMirrorVim host={host(readOnlyView, { isReadOnly: true })} />));
    expect(getCM(readOnlyView)).toBeNull();

    mocks.vimMode = false;
    const view = createView("hello");
    act(() => root.render(<CodeMirrorVim host={host(view)} />));
    expect(getCM(view)).toBeNull();
  });
});
