// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CodeMirrorHost } from "../engines/codemirror/host";

const mocks = vi.hoisted(() => ({
  enabled: true,
  blamedLines: new Set<number>([0, 1]),
  useGitBlame: vi.fn(),
}));

vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { enableInlineGitBlame: mocks.enabled } }),
}));
vi.mock("@/features/git/hooks/use-git-blame", () => ({
  useGitBlame: (filePath: string | undefined, bufferId: string) => {
    mocks.useGitBlame(filePath, bufferId);
    return {
      getBlameForLine: (line: number) =>
        filePath && mocks.blamedLines.has(line)
          ? { commit_hash: `hash-${line}`, author: `Author ${line}` }
          : null,
    };
  },
}));
vi.mock("@/features/git/services/git-blame-decoration", () => ({
  getInlineGitBlamePresentation: (line: { author: string; commit_hash: string }) => ({
    text: `  ${line.author}, today`,
    author: line.author,
    commitHash: line.commit_hash,
  }),
}));
vi.mock("@/features/git/components/inline-git-blame-card", () => ({
  InlineGitBlameCard: ({ presentation }: { presentation: { author: string } }) => (
    <div data-testid="blame-card">{presentation.author}</div>
  ),
}));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const { CodeMirrorInlineGitBlame } =
  await import("../engines/codemirror/features/codemirror-inline-git-blame");

let view: EditorView;
let root: Root;
let shell: HTMLDivElement;

function mount(host: Partial<CodeMirrorHost> = {}) {
  shell = document.createElement("div");
  document.body.append(shell);
  const editorParent = document.createElement("div");
  shell.append(editorParent);
  view = new EditorView({
    parent: editorParent,
    state: EditorState.create({ doc: "one\ntwo\nthree" }),
  });
  const fullHost: CodeMirrorHost = {
    view,
    container: shell,
    bufferId: "buffer-1",
    filePath: "/repo/a.ts",
    languageId: "typescript",
    viewStateKey: null,
    isActiveSurface: true,
    isReadOnly: false,
    isVirtual: false,
    getSeparator: () => "\n",
    applyHistory: () => true,
    ...host,
  };
  const reactParent = document.createElement("div");
  shell.append(reactParent);
  root = createRoot(reactParent);
  act(() => root.render(<CodeMirrorInlineGitBlame host={fullHost} />));
}

const blame = () => view.contentDOM.querySelector<HTMLElement>(".cm-inline-git-blame");

describe("CodeMirror inline git blame", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    mocks.enabled = true;
    mocks.blamedLines = new Set([0, 1]);
    mocks.useGitBlame.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    view.destroy();
    shell.remove();
    vi.useRealTimers();
  });

  it("shows the cursor line's blame at its end once the cursor settles", () => {
    mount();
    expect(blame()).toBeNull();

    act(() => vi.advanceTimersByTime(450));
    expect(blame()?.textContent).toBe("  Author 0, today");
    expect(blame()?.closest(".cm-line")?.textContent).toBe("one  Author 0, today");
  });

  it("hides the blame right away when the cursor leaves the line", () => {
    mount();
    act(() => vi.advanceTimersByTime(450));

    act(() => view.dispatch({ selection: { anchor: 5 } }));
    expect(blame()).toBeNull();

    act(() => vi.advanceTimersByTime(450));
    expect(blame()?.textContent).toBe("  Author 1, today");

    act(() => view.dispatch({ selection: { anchor: 9 } }));
    act(() => vi.advanceTimersByTime(450));
    expect(blame()).toBeNull();
  });

  it("does not load blame when the setting is off or the editor is inactive", () => {
    mocks.enabled = false;
    mount();
    act(() => vi.advanceTimersByTime(450));
    expect(blame()).toBeNull();
    expect(mocks.useGitBlame).toHaveBeenLastCalledWith(undefined, "buffer-1");
  });

  it("opens the commit card when the pointer rests on the blame and closes it after leaving", () => {
    mount();
    act(() => vi.advanceTimersByTime(450));
    const anchor = blame()!;

    act(() => {
      anchor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(499);
    });
    expect(document.querySelector('[data-testid="blame-card"]')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector('[data-testid="blame-card"]')?.textContent).toBe("Author 0");

    act(() => {
      anchor.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: shell }));
      vi.advanceTimersByTime(120);
    });
    expect(document.querySelector('[data-testid="blame-card"]')).toBeNull();
  });
});
