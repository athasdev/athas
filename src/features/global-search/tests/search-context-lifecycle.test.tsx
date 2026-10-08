// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { GlobalSearchResults } from "../components/global-search-results";
import { buildSearchExcerpts } from "../utils/search-excerpts";
import { useSearchContext } from "../hooks/use-search-context";
vi.mock("@/features/editor/components/multibuffer/multibuffer-workspace", () => ({
  MultibufferWorkspace: ({
    sections,
  }: {
    sections: Array<{ id: string; actions?: ReactNode }>;
  }) => (
    <>
      {sections.map((section) => (
        <div key={section.id}>{section.actions}</div>
      ))}
    </>
  ),
}));
vi.mock("../components/search-excerpt-code", () => ({ SearchExcerptCode: () => null }));
const io = vi.hoisted(() => ({ read: vi.fn(), error: vi.fn() }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readText: io.read }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("sonner", () => ({ toast: { error: io.error } }));
let root: Root;
let container: HTMLDivElement;
let context: ReturnType<typeof useSearchContext>;
const path = "/w/a.ts";
const disk = "disk before\nfoo\ndisk after";
function editor(content = "draft before\nfoo\ndraft after"): EditorContent {
  return {
    id: "same-id",
    type: "editor",
    path,
    name: "a.ts",
    content,
    savedContent: disk,
    isDirty: true,
    isVirtual: false,
    language: "typescript",
  };
}
const owner = () => useBufferStore.getStore("owner");
function Harness({
  workspaceId = "owner",
  searchKey = "search",
  inputQuery = "foo",
  searchRevision = 1,
  disabled = false,
  showActions = false,
}: {
  workspaceId?: string;
  searchKey?: string;
  inputQuery?: string;
  searchRevision?: number;
  disabled?: boolean;
  showActions?: boolean;
}) {
  context = useSearchContext({
    workspaceId,
    searchKey,
    inputQuery,
    searchRevision,
    disabled,
    results: [
      {
        file_path: path,
        total_matches: 1,
        matches: [{ line_number: 2, line_content: "foo", column_start: 0, column_end: 3 }],
      },
    ],
  });
  if (!showActions) return null;
  const results = [
    {
      file_path: path,
      total_matches: 1,
      matches: [{ line_number: 2, line_content: "foo", column_start: 0, column_end: 3 }],
    },
  ];
  return (
    <GlobalSearchResults
      workspaceRef={{ current: null }}
      scrollContainerRef={() => {}}
      loadMoreRef={{ current: null }}
      fileNavigatorItems={[]}
      selectedFileNavigatorKey={null}
      onFileNavigatorSelect={() => {}}
      fileNavigatorViewMode="flat"
      onFileNavigatorViewModeChange={() => {}}
      navigatorSearchResetKey={searchKey}
      showFileNavigator={false}
      onShowFileNavigatorChange={() => {}}
      excerpts={buildSearchExcerpts(results, "/w", 10, context)}
      selectedItemKey={null}
      onOpen={() => {}}
      onExpandContext={context.expandContext}
      onCollapseContext={context.collapseContext}
      isContextExpanded={context.isContextExpanded}
      isContextLoading={context.isContextLoading}
      hasMore={false}
      isLoadingMore={false}
      displayedCount={1}
      totalMatches={1}
      hasMoreResults={false}
    />
  );
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function mount(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(<Harness {...props} />));
}
async function expand() {
  await act(async () => context.expandContext(path));
}
async function start() {
  let pending = Promise.resolve();
  await act(async () => {
    pending = context.expandContext(path);
  });
  return { pending };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  owner().setState({ buffers: [] });
  io.read.mockReset().mockResolvedValue(disk);
  io.error.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("search context lifetimes", () => {
  it("loads more context through the file provider and clears loading", async () => {
    await mount();
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const { pending } = await start();
    expect(context.isContextLoading(path)).toBe(true);
    expect(context.isContextExpanded(path)).toBe(false);
    await act(async () => {
      read.resolve(disk);
      await pending;
    });
    expect(context.sourceContentByPath[path]).toBe(disk);
    expect(context.contextLinesByFile[path]).toBe(7);
    expect(context.isContextLoading(path)).toBe(false);
  });
  it("uses the owning workspace draft even when another workspace is active", async () => {
    owner().setState({ buffers: [editor()] });
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({ buffers: [editor("other\nfoo\nother")] });
    await mount();
    await expand();
    expect(context.sourceContentByPath[path]).toBe(editor().content);
    expect(io.read).not.toHaveBeenCalled();
  });
  it("keeps expanded context current as the draft changes around its matches", async () => {
    owner().setState({ buffers: [editor()] });
    await mount();
    await expand();
    await act(async () =>
      owner().getState().actions.updateBufferContent("same-id", "new draft\nfoo\nnew after", true),
    );
    expect(context.sourceContentByPath[path]).toBe("new draft\nfoo\nnew after");
  });
  it("hides expansion when the displayed match line changes", async () => {
    owner().setState({ buffers: [editor()] });
    await mount();
    await expand();
    await act(async () =>
      owner().getState().actions.updateBufferContent("same-id", "draft\nchanged\nafter", true),
    );
    expect(context.isContextExpanded(path)).toBe(false);
    expect(context.sourceContentByPath).toEqual({});
  });
  it("drops draft context when its buffer closes", async () => {
    owner().setState({ buffers: [editor()] });
    await mount();
    await expand();
    await act(async () => owner().setState({ buffers: [] }));
    expect(context.isContextExpanded(path)).toBe(false);
  });
  it("prefers a draft opened while a disk read is pending", async () => {
    await mount();
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const { pending } = await start();
    await act(async () => owner().setState({ buffers: [editor()] }));
    await act(async () => {
      read.resolve(disk);
      await pending;
    });
    expect(context.sourceContentByPath[path]).toBe(editor().content);
  });
  it("refuses context whose match positions no longer agree with the search", async () => {
    io.read.mockResolvedValue("inserted\nother\nfoo");
    await mount();
    await expand();
    expect(context.isContextExpanded(path)).toBe(false);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("changed since this search"));
  });
  it("coalesces expansion before React updates", async () => {
    await mount();
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    let first = Promise.resolve();
    let second = Promise.resolve();
    await act(async () => {
      first = context.expandContext(path);
      second = context.expandContext(path);
    });
    expect(first).toBe(second);
    expect(io.read).toHaveBeenCalledTimes(1);
    await act(async () => {
      read.resolve(disk);
      await first;
    });
    expect(context.isContextExpanded(path)).toBe(true);
  });
  it("does not expand after a pending expansion was collapsed", async () => {
    await mount();
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const { pending } = await start();
    await act(async () => context.collapseContext(path));
    await act(async () => {
      read.resolve(disk);
      await pending;
    });
    expect(context.isContextExpanded(path)).toBe(false);
    expect(context.isContextLoading(path)).toBe(false);
  });
  it("reads again after collapsing completed context", async () => {
    await mount();
    await expand();
    await act(async () => context.collapseContext(path));
    io.read.mockResolvedValue("updated\nfoo\nupdated");
    await expand();
    expect(io.read).toHaveBeenCalledTimes(2);
    expect(context.sourceContentByPath[path]).toBe("updated\nfoo\nupdated");
  });
  it("invalidates old reads when the same search is refreshed", async () => {
    await mount();
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const { pending } = await start();
    await mount({ searchRevision: 2 });
    await act(async () => {
      read.resolve(disk);
      await pending;
    });
    expect(context.sourceContentByPath).toEqual({});
    await expand();
    expect(context.isContextExpanded(path)).toBe(true);
    expect(io.read).toHaveBeenCalledTimes(2);
  });
  it("does not restore old context after the query changes away and back", async () => {
    await mount();
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const { pending } = await start();
    await mount({ inputQuery: "bar" });
    await mount();
    await act(async () => {
      read.resolve(disk);
      await pending;
    });
    expect(context.sourceContentByPath).toEqual({});
  });
  it("ignores a late failure after unmount and retained callbacks", async () => {
    await mount();
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const { pending } = await start();
    const oldExpand = context.expandContext;
    await act(async () => root.render(null));
    await act(async () => {
      read.reject(new Error("offline"));
      await pending;
      await oldExpand(path);
    });
    expect(io.error).not.toHaveBeenCalled();
    expect(io.read).toHaveBeenCalledTimes(1);
  });
  it("rejects reads from a retired owner recreated with the same ID", async () => {
    await mount();
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const { pending } = await start();
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    workspaceRuntimeRegistry.removeWorkspace("owner");
    workspaceRuntimeRegistry.ensureWorkspace({ id: "owner", name: "New" });
    useBufferStore.getStore("owner").setState({ buffers: [] });
    await act(async () => {
      read.resolve(disk);
      await pending;
    });
    expect(context.sourceContentByPath).toEqual({});
  });
  it("allows a failed read to retry", async () => {
    io.read.mockRejectedValueOnce(new Error("offline"));
    await mount();
    await expand();
    expect(context.isContextLoading(path)).toBe(false);
    expect(io.error).toHaveBeenCalledWith("offline");
    await expand();
    expect(context.isContextExpanded(path)).toBe(true);
    expect(io.read).toHaveBeenCalledTimes(2);
  });
  it("does not read a missing result or a disabled search", async () => {
    await mount({ disabled: true });
    await expand();
    await mount();
    await act(async () => context.expandContext("/other.ts"));
    expect(io.read).not.toHaveBeenCalled();
  });
  it("handles CRLF and lone CR context without moving the match", async () => {
    io.read.mockResolvedValue("before\r\nfoo\rafter");
    await mount();
    await expand();
    expect(context.isContextExpanded(path)).toBe(true);
  });
  it("prevents native reads when expansion is collapsed before launch", async () => {
    await mount();
    let pending = Promise.resolve();
    await act(async () => {
      pending = context.expandContext(path);
      context.collapseContext(path);
      await pending;
    });
    expect(io.read).not.toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();
  });
  it("keeps a new expansion pending when an older collapsed request finishes", async () => {
    await mount();
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const old = await start();
    await act(async () => context.collapseContext(path));
    const next = await start();
    expect(io.read).toHaveBeenCalledTimes(1);
    expect(context.isContextLoading(path)).toBe(true);
    await act(async () => {
      read.resolve(disk);
      await Promise.all([old.pending, next.pending]);
    });
    expect(context.isContextExpanded(path)).toBe(true);
    expect(context.isContextLoading(path)).toBe(false);
  });
  it("refuses an unsaved source closed before context is published and allows a saved-file retry", async () => {
    owner().setState({ buffers: [editor()] });
    await mount();
    await act(async () => {
      const pending = context.expandContext(path);
      owner().setState({ buffers: [] });
      await pending;
    });
    expect(context.isContextExpanded(path)).toBe(false);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("was closed"));
    await expand();
    expect(context.sourceContentByPath[path]).toBe(disk);
  });
  it("displays loading, prevents repeated clicks and offers collapse after a successful read", async () => {
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    await mount({ showActions: true });
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand context"]',
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Loading context",
    );
    await act(async () => button?.click());
    expect(io.read).toHaveBeenCalledTimes(1);
    await act(async () => read.resolve(disk));
    const collapse = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse context"]',
    );
    expect(collapse?.disabled).toBe(false);
    await act(async () => collapse?.click());
    expect(container.querySelector('button[aria-label="Expand context"]')).not.toBeNull();
  });
  it("restores the expansion control after a failed read so it can retry", async () => {
    io.read.mockRejectedValueOnce(new Error("offline"));
    await mount({ showActions: true });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Expand context"]')?.click(),
    );
    const retry = container.querySelector<HTMLButtonElement>('button[aria-label="Expand context"]');
    expect(retry?.disabled).toBe(false);
    expect(retry?.hasAttribute("aria-busy")).toBe(false);
    await act(async () => retry?.click());
    expect(container.querySelector('button[aria-label="Collapse context"]')).not.toBeNull();
  });
});
