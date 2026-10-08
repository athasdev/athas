// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContextMenuHandlers } from "../context-menu/editor-context-menu-items";
import type { CodeMirrorHost } from "../engines/codemirror/host";

type MenuProps = EditorContextMenuHandlers & {
  position: { x: number; y: number };
  onClose: () => void;
};

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  menuProps: null as MenuProps | null,
}));

vi.mock("@/features/keymaps/services/keymap-registry", () => ({
  keymapRegistry: { executeCommand: mocks.executeCommand },
}));
vi.mock("@/features/editor/context-menu/context-menu", () => ({
  default: (props: MenuProps) => {
    mocks.menuProps = props;
    return <div data-testid="editor-context-menu" />;
  },
}));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { toggleSelectionCase } = await import("../engines/codemirror/toggle-case");
const { CodeMirrorContextMenu, placeCursorForContextMenu } =
  await import("../engines/codemirror/features/codemirror-context-menu");

let views: EditorView[] = [];

function createView(doc: string, selection?: EditorSelection, readOnly = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true), EditorState.readOnly.of(readOnly)],
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

describe("toggleSelectionCase", () => {
  it("toggles every selection and keeps it selected", () => {
    const view = createView(
      "hello WORLD MiXed",
      EditorSelection.create([
        EditorSelection.range(0, 5),
        EditorSelection.range(6, 11),
        EditorSelection.range(17, 12),
      ]),
    );

    expect(toggleSelectionCase(view)).toBe(true);

    expect(view.state.doc.toString()).toBe("HELLO world MIXED");
    expect(view.state.selection.ranges.map(({ anchor, head }) => [anchor, head])).toEqual([
      [0, 5],
      [6, 11],
      [17, 12],
    ]);
  });

  it("does nothing without a selection or in a read-only editor", () => {
    expect(toggleSelectionCase(createView("hello"))).toBe(false);
    const readOnly = createView("hello", EditorSelection.single(0, 5), true);
    expect(toggleSelectionCase(readOnly)).toBe(false);
    expect(readOnly.state.doc.toString()).toBe("hello");
  });
});

describe("placeCursorForContextMenu", () => {
  it("moves the cursor to a click outside the selection", () => {
    const view = createView("hello world", EditorSelection.single(0, 5));
    view.posAtCoords = () => 8;

    placeCursorForContextMenu(view, { x: 1, y: 1 });

    expect(view.state.selection.main).toMatchObject({ from: 8, to: 8 });
  });

  it("keeps the selection for a click inside it", () => {
    const view = createView("hello world", EditorSelection.single(0, 5));
    view.posAtCoords = () => 3;

    placeCursorForContextMenu(view, { x: 1, y: 1 });

    expect(view.state.selection.main).toMatchObject({ from: 0, to: 5 });
  });
});

describe("CodeMirrorContextMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.executeCommand.mockClear();
    mocks.menuProps = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function openMenu(view: EditorView, isReadOnly = false) {
    const host = { view, container, isReadOnly } as unknown as CodeMirrorHost;
    act(() => root.render(<CodeMirrorContextMenu host={host} />));
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 20,
    });
    act(() => {
      view.contentDOM.dispatchEvent(event);
    });
    return event;
  }

  it("opens the editor context menu at the right click", () => {
    const view = createView("hello world");
    const event = openMenu(view);

    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector("[data-testid='editor-context-menu']")).not.toBeNull();
    expect(mocks.menuProps?.position).toEqual({ x: 40, y: 20 });

    act(() => mocks.menuProps?.onClose());
    expect(document.querySelector("[data-testid='editor-context-menu']")).toBeNull();
  });

  it("runs editor commands and edits the text", () => {
    const view = createView("hello world", EditorSelection.single(0, 5));
    view.posAtCoords = () => 2;
    openMenu(view);
    const props = mocks.menuProps;
    if (!props) throw new Error("No context menu");

    props.onCopy?.();
    props.onToggleComment?.();
    props.onFind?.();
    expect(mocks.executeCommand.mock.calls).toEqual([
      ["editor.copy"],
      ["editor.toggleComment"],
      ["workbench.showFind"],
    ]);

    act(() => props.onToggleCase?.());
    expect(view.state.doc.toString()).toBe("HELLO world");

    act(() => props.onDelete?.());
    expect(view.state.doc.toString()).toBe(" world");
  });

  it("leaves out editing actions in a read-only editor", () => {
    const view = createView("hello world");
    openMenu(view, true);
    const props = mocks.menuProps;

    expect(props?.onCopy).toBeDefined();
    expect(props?.onCut).toBeUndefined();
    expect(props?.onPaste).toBeUndefined();
    expect(props?.onDelete).toBeUndefined();
    expect(props?.onToggleCase).toBeUndefined();
    expect(props?.onRenameSymbol).toBeUndefined();
  });
});
