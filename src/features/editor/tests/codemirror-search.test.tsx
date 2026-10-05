// @vitest-environment jsdom
import { getSearchQuery, search, SearchQuery, searchPanelOpen } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CodeMirrorHost } from "../engines/codemirror/host";

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { formatSearchMatchLabel, openCodeMirrorSearch, summarizeSearchMatches } =
  await import("../engines/codemirror/search");
const { CodeMirrorSearch } = await import("../engines/codemirror/features/codemirror-search");

describe("search match summary", () => {
  const state = EditorState.create({
    doc: "foo bar foo baz foo",
    selection: EditorSelection.single(8, 11),
  });

  it("counts matches and finds the one the selection covers", () => {
    const summary = summarizeSearchMatches(state, new SearchQuery({ search: "foo" }));
    expect(summary).toEqual({ current: 2, total: 3, capped: false });
    expect(formatSearchMatchLabel(summary)).toBe("2 of 3");
  });

  it("stops counting at the limit", () => {
    const summary = summarizeSearchMatches(state, new SearchQuery({ search: "foo" }), 2);
    expect(summary).toEqual({ current: 2, total: 2, capped: true });
    expect(formatSearchMatchLabel({ current: 0, total: 2, capped: true })).toBe("? of 2+");
  });

  it("reports no matches for empty, missing and invalid queries", () => {
    expect(summarizeSearchMatches(state, new SearchQuery({ search: "" })).total).toBe(0);
    expect(summarizeSearchMatches(state, new SearchQuery({ search: "nope" })).total).toBe(0);
    expect(
      summarizeSearchMatches(state, new SearchQuery({ search: "(", regexp: true })).total,
    ).toBe(0);
    expect(formatSearchMatchLabel({ current: 0, total: 0, capped: false })).toBe("No results");
  });
});

describe("CodeMirrorSearch", () => {
  let container: HTMLDivElement;
  let root: Root;
  let view: EditorView;

  function render(readOnly = false) {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "alpha beta alpha",
        extensions: [search({ top: true }), EditorState.readOnly.of(readOnly)],
      }),
    });
    const host = { view, container, isReadOnly: readOnly } as unknown as CodeMirrorHost;
    act(() => root.render(<CodeMirrorSearch host={host} />));
  }

  const panel = () => view.dom.querySelector<HTMLElement>(".cm-athas-search");
  const findField = () => panel()?.querySelector<HTMLInputElement>("input[name=search]") ?? null;
  const replaceField = () =>
    panel()?.querySelector<HTMLInputElement>("input[name=replace]") ?? null;

  function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function press(input: HTMLInputElement, key: string, init: KeyboardEventInit = {}) {
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
      );
    });
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    view.dom.parentElement?.remove();
    view.destroy();
    container.remove();
    await Promise.resolve();
  });

  it("opens the Athas find widget with the find field focused", () => {
    render();
    act(() => openCodeMirrorSearch(view));

    expect(searchPanelOpen(view.state)).toBe(true);
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(findField());
    expect(replaceField()).toBeNull();
  });

  it("searches as the user types and moves between matches", () => {
    render();
    act(() => openCodeMirrorSearch(view));
    const field = findField();
    if (!field) throw new Error("No find field");

    type(field, "alpha");
    expect(getSearchQuery(view.state).search).toBe("alpha");
    expect(panel()?.textContent).toContain("? of 2");

    press(field, "Enter");
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 5 });
    expect(panel()?.textContent).toContain("1 of 2");
    press(field, "Enter");
    expect(view.state.selection.main).toMatchObject({ from: 11, to: 16 });
    expect(panel()?.textContent).toContain("2 of 2");

    press(field, "Enter", { shiftKey: true });
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 5 });
  });

  it("opens replace with the replace field focused and replaces matches", () => {
    render();
    act(() => openCodeMirrorSearch(view, { replace: true }));
    const replace = replaceField();
    const field = findField();
    if (!replace || !field) throw new Error("No replace field");
    expect(document.activeElement).toBe(replace);

    type(field, "alpha");
    type(replace, "gamma");
    press(replace, "Enter", { metaKey: true });

    expect(view.state.doc.toString()).toBe("gamma beta gamma");
  });

  it("does not offer replace in a read-only editor", () => {
    render(true);
    act(() => openCodeMirrorSearch(view, { replace: true }));

    expect(panel()).not.toBeNull();
    expect(replaceField()).toBeNull();
    expect(panel()?.querySelector("[aria-label='Show replace']")).toBeNull();
  });

  it("closes on Escape and gives focus back to the text", () => {
    render();
    act(() => openCodeMirrorSearch(view));
    const field = findField();
    if (!field) throw new Error("No find field");

    press(field, "Escape");

    expect(searchPanelOpen(view.state)).toBe(false);
    expect(view.hasFocus || document.activeElement === view.contentDOM).toBe(true);
  });
});
