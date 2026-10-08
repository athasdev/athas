// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSourceReplacement } from "../hooks/use-source-replacement";
vi.mock("../services/search-worker-client", async () => {
  const { executeSearchTask } = await import("../workers/search-worker-execution");
  return {
    createSearchWorkerSession: () => ({
      run: async (task: Parameters<typeof executeSearchTask>[0]) => executeSearchTask(task),
      dispose: () => {},
    }),
  };
});
const io = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readText: io.read, writeText: io.write }),
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("sonner", () => ({ toast: { success: io.success, warning: io.warning, error: io.error } }));
let root: Root;
let container: HTMLDivElement;
let operations: ReturnType<typeof useSourceReplacement>;
const paths = ["/w/a.ts", "/w/b.ts"];
function Harness({
  query = "foo",
  inputQuery = query,
  searchKey = "search",
  workspaceId = "owner",
  replacement = "new",
}: {
  query?: string;
  inputQuery?: string;
  searchKey?: string;
  workspaceId?: string;
  replacement?: string;
}) {
  operations = useSourceReplacement({
    workspaceId,
    query,
    inputQuery,
    searchKey,
    replacement,
    options: { caseSensitive: true, wholeWord: false, useRegex: false },
    refreshSearch: io.refresh,
  });
  return null;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
async function start() {
  let pending: Promise<void> = Promise.resolve();
  await act(async () => {
    pending = operations.replaceAll(paths);
  });
  return { pending };
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  useBufferStore.setState({ buffers: [] });
  io.read.mockReset().mockResolvedValue("foo foo");
  io.write.mockReset().mockResolvedValue(undefined);
  io.refresh.mockReset().mockResolvedValue(undefined);
  io.success.mockClear();
  io.warning.mockClear();
  io.error.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("search replacement view lifecycle", () => {
  it("refreshes completed results and reports the exact replacement count", async () => {
    await act(async () => operations.replaceAll(paths));
    expect(io.write).toHaveBeenCalledTimes(2);
    expect(io.refresh).toHaveBeenCalledOnce();
    expect(io.success).toHaveBeenCalledWith("Replaced 4 matches");
    expect(operations.replaceOperation).toBeNull();
  });
  it("locks duplicate submissions immediately before a render", async () => {
    const write = deferred<void>();
    io.write.mockReturnValueOnce(write.promise);
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = operations.replaceAll(paths);
      void operations.replaceAll(paths);
    });
    expect(io.write).toHaveBeenCalledOnce();
    expect(operations.replaceOperation).toBe("all");
    await act(async () => {
      write.resolve();
      await pending;
    });
    expect(io.write).toHaveBeenCalledTimes(2);
  });
  it("cancels when the visible input changes before the debounce result", async () => {
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const run = await start();
    await act(async () => root.render(<Harness inputQuery="different" />));
    await act(async () => {
      read.resolve("foo foo");
      await run.pending;
    });
    expect(io.write).not.toHaveBeenCalled();
    expect(io.refresh).not.toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();
    expect(operations.replaceOperation).toBeNull();
  });
  it("keeps an already committed write but stops later writes after unmount", async () => {
    const write = deferred<void>();
    io.write.mockReturnValueOnce(write.promise);
    const run = await start();
    expect(io.write).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    await act(async () => {
      write.resolve();
      await run.pending;
    });
    expect(io.write).toHaveBeenCalledOnce();
    expect(io.refresh).not.toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();
    expect(io.success).not.toHaveBeenCalled();
  });
  it("does not clear a newer operation when a canceled old read finishes", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    io.read.mockReturnValueOnce(first.promise);
    const old = await start();
    await act(async () => root.render(<Harness query="bar" searchKey="new" />));
    io.read.mockReturnValueOnce(second.promise);
    const newer = await start();
    await act(async () => {
      first.resolve("foo foo");
      await old.pending;
    });
    expect(operations.replaceOperation).toBe("all");
    await act(async () => {
      second.resolve("bar bar");
      await newer.pending;
    });
    expect(io.write).toHaveBeenCalledOnce();
    expect(io.write).toHaveBeenCalledWith(paths[0], "new new", "bar bar");
    expect(operations.replaceOperation).toBeNull();
  });
  it("cancels a reused search view when its workspace changes", async () => {
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const run = await start();
    await act(async () => {
      workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
      root.render(<Harness workspaceId="other" />);
    });
    await act(async () => {
      read.resolve("foo foo");
      await run.pending;
    });
    expect(io.write).not.toHaveBeenCalled();
    expect(io.success).not.toHaveBeenCalled();
  });
  it("keeps parked workspace results scoped and suppresses notifications in another workspace", async () => {
    const write = deferred<void>();
    io.write.mockReturnValueOnce(write.promise);
    const run = await start();
    await act(async () =>
      workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" }),
    );
    await act(async () => {
      write.resolve();
      await run.pending;
    });
    expect(io.write).toHaveBeenCalledTimes(2);
    expect(io.refresh).toHaveBeenCalledOnce();
    expect(io.success).not.toHaveBeenCalled();
  });
  it("refreshes partial changes and surfaces the completed count on a later write failure", async () => {
    io.write.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Disk conflict"));
    await act(async () => operations.replaceAll(paths));
    expect(io.refresh).toHaveBeenCalledOnce();
    expect(io.error).toHaveBeenCalledWith(
      expect.stringContaining("Replaced 2 match(es) in 1 file(s)"),
    );
    expect(io.success).not.toHaveBeenCalled();
    expect(operations.replaceOperation).toBeNull();
  });
  it("reports refresh failure as a completed replacement with a warning", async () => {
    io.refresh.mockRejectedValueOnce(new Error("Search unavailable"));
    await act(async () => operations.replaceAll(paths));
    expect(io.write).toHaveBeenCalledTimes(2);
    expect(io.warning).toHaveBeenCalledWith(expect.stringContaining("Replaced 4 match(es)"));
    expect(io.error).not.toHaveBeenCalled();
    expect(io.success).not.toHaveBeenCalled();
  });
  it("does not notify an old view after a slow refresh finishes", async () => {
    const refresh = deferred<void>();
    io.refresh.mockReturnValueOnce(refresh.promise);
    const run = await start();
    expect(io.refresh).toHaveBeenCalledOnce();
    await act(async () => root.render(<Harness query="changed" />));
    await act(async () => {
      refresh.resolve();
      await run.pending;
    });
    expect(io.success).not.toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();
  });
  it("keeps the partial replacement error when the subsequent refresh also fails", async () => {
    io.write.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Disk conflict"));
    io.refresh.mockRejectedValueOnce(new Error("Refresh failed"));
    await act(async () => operations.replaceAll(paths));
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("Disk conflict"));
    expect(io.warning).not.toHaveBeenCalled();
  });
  it("does not refresh or notify for an unchanged replacement", async () => {
    await act(async () => root.render(<Harness replacement="foo" />));
    await act(async () => operations.replaceAll(paths));
    expect(io.write).not.toHaveBeenCalled();
    expect(io.refresh).not.toHaveBeenCalled();
    expect(io.success).not.toHaveBeenCalled();
    expect(operations.replaceOperation).toBeNull();
  });
});
