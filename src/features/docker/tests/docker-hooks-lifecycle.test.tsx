// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const events = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: new Map<string, ReturnType<typeof vi.fn>>(),
  failOn: null as string | null,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    if (events.failOn === name) throw new Error(`cannot listen to ${name}`);
    events.handlers.set(name, handler);
    const unlisten = vi.fn(() => events.handlers.delete(name));
    events.unlisten.set(name, unlisten);
    return unlisten;
  }),
}));

import { commands } from "@/bindings/commands";
import { useDockerContainerFiles } from "../hooks/use-docker-container-files";
import { useDockerContainerLogs } from "../hooks/use-docker-container-logs";
import { useDockerRegistry } from "../hooks/use-docker-registry";
import type { DockerContainerFileEntry } from "@/bindings/commands";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let roots: Root[] = [];

async function renderHook<P, T>(useHook: (props: P) => T, initialProps: P) {
  const result = {} as { current: T };
  function Probe({ props }: { props: P }) {
    result.current = useHook(props);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(Probe, { props: initialProps })));
  return {
    result,
    rerender: (props: P) => act(async () => root.render(createElement(Probe, { props }))),
    unmount: () => act(async () => root.unmount()),
  };
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
}

function emit(name: string, payload: unknown) {
  act(() => events.handlers.get(name)?.({ payload }));
}

const logLine = (streamId: string, line: string, stream: "stdout" | "stderr" = "stdout") => ({
  streamId,
  containerId: "c1",
  stream,
  line,
});

beforeEach(() => {
  events.handlers.clear();
  events.unlisten.clear();
  events.failOn = null;
});

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots = [];
  vi.restoreAllMocks();
});

describe("useDockerContainerLogs", () => {
  it("streams lines for the active stream and filters them", async () => {
    vi.spyOn(commands, "dockerStartContainerLogStream").mockResolvedValue("stream-1");
    const stop = vi.spyOn(commands, "dockerStopContainerLogStream").mockResolvedValue(null);
    const { result, unmount } = await renderHook(
      ({ id }: { id: string | null }) => useDockerContainerLogs(id),
      { id: "c1" },
    );
    await settle();

    expect(commands.dockerStartContainerLogStream).toHaveBeenCalledWith("c1", 300);
    expect(result.current.streamId).toBe("stream-1");

    emit("docker-container-log", logLine("stream-1", "Server listening"));
    emit("docker-container-log", logLine("stream-1", "Error: database refused", "stderr"));
    emit("docker-container-log", logLine("other-stream", "ignored"));

    expect(result.current.lines.map((line) => line.line)).toEqual([
      "Server listening",
      "Error: database refused",
    ]);
    expect(result.current.lines.map((line) => line.id)).toEqual([0, 1]);

    act(() => result.current.setFilter("stderr"));
    expect(result.current.filteredLines.map((line) => line.line)).toEqual([
      "Error: database refused",
    ]);
    act(() => result.current.setFilter("stdout"));
    expect(result.current.filteredLines.map((line) => line.line)).toEqual(["Server listening"]);
    act(() => result.current.setFilter("errors"));
    expect(result.current.filteredLines.map((line) => line.line)).toEqual([
      "Error: database refused",
    ]);
    act(() => {
      result.current.setFilter("all");
      result.current.setQuery("  LISTEN ");
    });
    expect(result.current.filteredLines.map((line) => line.line)).toEqual(["Server listening"]);

    act(() => result.current.clearLines());
    expect(result.current.lines).toEqual([]);

    await unmount();
    roots = [];
    expect(stop).toHaveBeenCalledWith("stream-1");
    expect(events.unlisten.get("docker-container-log")).toHaveBeenCalled();
    expect(events.unlisten.get("docker-container-log-exit")).toHaveBeenCalled();
  });

  it("reports how the stream exited", async () => {
    vi.spyOn(commands, "dockerStartContainerLogStream").mockResolvedValue("stream-2");
    vi.spyOn(commands, "dockerStopContainerLogStream").mockResolvedValue(null);
    const { result } = await renderHook(() => useDockerContainerLogs("c1"), {});
    await settle();

    emit("docker-container-log-exit", { streamId: "other", containerId: "c1", code: 1 });
    expect(result.current.streamId).toBe("stream-2");

    emit("docker-container-log-exit", { streamId: "stream-2", containerId: "c1", code: 137 });

    expect(result.current.streamId).toBeNull();
    expect(result.current.error).toBe("Docker log stream exited with code 137.");
  });

  it("reports a stream that could not start and removes its listeners", async () => {
    vi.spyOn(commands, "dockerStartContainerLogStream").mockRejectedValue(
      new Error("No such container"),
    );
    const { result } = await renderHook(() => useDockerContainerLogs("gone"), {});
    await settle();

    expect(result.current.error).toBe("No such container");
    expect(result.current.streamId).toBeNull();
    expect(events.handlers.size).toBe(0);
  });

  it("reports a listener failure", async () => {
    events.failOn = "docker-container-log-exit";
    const start = vi.spyOn(commands, "dockerStartContainerLogStream");
    const { result } = await renderHook(() => useDockerContainerLogs("c1"), {});
    await settle();

    expect(result.current.error).toBe("cannot listen to docker-container-log-exit");
    expect(start).not.toHaveBeenCalled();
    expect(events.handlers.has("docker-container-log")).toBe(false);
  });

  it("stops a stream that starts after the container changed", async () => {
    const pending = deferred<string>();
    vi.spyOn(commands, "dockerStartContainerLogStream")
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue("stream-b");
    const stop = vi.spyOn(commands, "dockerStopContainerLogStream").mockResolvedValue(null);
    const { result, rerender } = await renderHook(
      ({ id }: { id: string | null }) => useDockerContainerLogs(id),
      { id: "a" },
    );
    await settle();

    await rerender({ id: "b" });
    await settle();
    pending.resolve("stream-a");
    await settle();

    expect(stop).toHaveBeenCalledWith("stream-a");
    expect(result.current.streamId).toBe("stream-b");
  });

  it("does nothing without a container", async () => {
    const start = vi.spyOn(commands, "dockerStartContainerLogStream");
    const { result } = await renderHook(() => useDockerContainerLogs(null), {});
    await settle();

    expect(start).not.toHaveBeenCalled();
    expect(result.current.lines).toEqual([]);
  });
});

const fileEntry = (name: string) => ({ name, path: `/${name}` }) as DockerContainerFileEntry;

describe("useDockerContainerFiles", () => {
  it("lists files for the current path once enabled", async () => {
    const list = vi
      .spyOn(commands, "dockerListContainerFiles")
      .mockResolvedValueOnce([fileEntry("etc")])
      .mockResolvedValueOnce([fileEntry("hosts")]);
    const { result, rerender } = await renderHook(
      ({ enabled }: { enabled: boolean }) => useDockerContainerFiles("c1", enabled),
      { enabled: false },
    );
    await settle();
    expect(list).not.toHaveBeenCalled();

    await rerender({ enabled: true });
    await settle();
    expect(list).toHaveBeenLastCalledWith("c1", "/");
    expect(result.current.files).toEqual([fileEntry("etc")]);
    expect(result.current.isLoading).toBe(false);

    act(() => result.current.setPath("/etc"));
    await settle();
    expect(list).toHaveBeenLastCalledWith("c1", "/etc");
    expect(result.current.files).toEqual([fileEntry("hosts")]);
  });

  it("shows listing failures and clears them", async () => {
    vi.spyOn(commands, "dockerListContainerFiles").mockRejectedValue("permission denied");
    const { result } = await renderHook(() => useDockerContainerFiles("c1", true), {});
    await settle();

    expect(result.current.error).toBe("permission denied");
    expect(result.current.files).toEqual([]);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();

    act(() => result.current.reportError(new Error("copy failed")));
    expect(result.current.error).toBe("copy failed");
  });

  it("drops a listing that finishes after the path changed", async () => {
    const slow = deferred<DockerContainerFileEntry[]>();
    vi.spyOn(commands, "dockerListContainerFiles")
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([fileEntry("var")]);
    const { result } = await renderHook(() => useDockerContainerFiles("c1", true), {});
    await settle();

    act(() => result.current.setPath("/var"));
    await settle();
    slow.resolve([fileEntry("stale")]);
    await settle();

    expect(result.current.path).toBe("/var");
    expect(result.current.files).toEqual([fileEntry("var")]);
  });

  it("drops a failed listing that finishes after the container changed", async () => {
    const slow = deferred<DockerContainerFileEntry[]>();
    vi.spyOn(commands, "dockerListContainerFiles")
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([fileEntry("b")]);
    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useDockerContainerFiles(id, true),
      { id: "a" },
    );
    await settle();

    await rerender({ id: "b" });
    await settle();
    slow.reject(new Error("container stopped"));
    await settle();

    expect(result.current.containerId).toBe("b");
    expect(result.current.error).toBeNull();
    expect(result.current.files).toEqual([fileEntry("b")]);
  });
});

describe("useDockerRegistry", () => {
  async function renderRegistry() {
    const onDockerUnavailable = vi.fn();
    const onInventoryChanged = vi.fn(async () => {});
    const hook = await renderHook(
      () => useDockerRegistry({ onDockerUnavailable, onInventoryChanged }),
      {},
    );
    return { ...hook, onDockerUnavailable, onInventoryChanged };
  }

  it("logs in with trimmed credentials and forgets the password afterwards", async () => {
    const login = vi.spyOn(commands, "dockerRegistryLogin").mockResolvedValue("  ");
    const { result } = await renderRegistry();

    await act(async () => result.current.login());
    expect(login).not.toHaveBeenCalled();

    act(() => {
      result.current.setDraftField("username", "  dev ");
      result.current.setDraftField("password", "secret");
    });
    await act(async () => result.current.login());

    expect(login).toHaveBeenCalledWith({ registry: null, username: "dev", password: "secret" });
    expect(result.current.output).toBe("Docker registry login completed.");
    expect(result.current.draft.password).toBe("");
    expect(result.current.isBusy).toBe(false);
  });

  it("passes a custom registry and reports login failures", async () => {
    const login = vi.spyOn(commands, "dockerRegistryLogin").mockRejectedValue("unauthorized");
    const { result, onDockerUnavailable } = await renderRegistry();

    act(() => {
      result.current.setDraftField("registry", " ghcr.io ");
      result.current.setDraftField("username", "dev");
      result.current.setDraftField("password", "bad");
    });
    await act(async () => result.current.login());

    expect(login).toHaveBeenCalledWith({ registry: "ghcr.io", username: "dev", password: "bad" });
    expect(result.current.error).toBe("unauthorized");
    expect(result.current.draft.password).toBe("bad");
    expect(onDockerUnavailable).not.toHaveBeenCalled();

    act(() => result.current.dismissError());
    expect(result.current.error).toBeNull();
  });

  it("pulls images, refreshes the inventory, and falls back to a summary", async () => {
    vi.spyOn(commands, "dockerRegistryPull").mockResolvedValue("");
    const { result, onInventoryChanged } = await renderRegistry();

    await act(async () => result.current.pull("   "));
    expect(commands.dockerRegistryPull).not.toHaveBeenCalled();

    await act(async () => result.current.pull(" nginx:latest "));

    expect(commands.dockerRegistryPull).toHaveBeenCalledWith("nginx:latest");
    expect(result.current.output).toBe("Pulled nginx:latest.");
    expect(onInventoryChanged).toHaveBeenCalledOnce();
  });

  it("tells the sidebar when Docker is not running", async () => {
    vi.spyOn(commands, "dockerRegistryPull").mockRejectedValue(
      new Error("Cannot connect to the Docker daemon at unix:///var/run/docker.sock"),
    );
    const { result, onDockerUnavailable, onInventoryChanged } = await renderRegistry();

    await act(async () => result.current.pull("nginx"));

    expect(onDockerUnavailable).toHaveBeenCalledWith(
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
    );
    expect(onInventoryChanged).not.toHaveBeenCalled();
    expect(result.current.isBusy).toBe(false);
  });

  it("pushes and tags the drafted image", async () => {
    vi.spyOn(commands, "dockerRegistryPush")
      .mockResolvedValueOnce("pushed digest sha256:1\n")
      .mockRejectedValueOnce(new Error("denied"));
    vi.spyOn(commands, "dockerTagImage")
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("no such image"));
    const { result, onInventoryChanged } = await renderRegistry();

    await act(async () => result.current.push());
    await act(async () => result.current.tag());
    expect(commands.dockerRegistryPush).not.toHaveBeenCalled();
    expect(commands.dockerTagImage).not.toHaveBeenCalled();

    act(() => {
      result.current.setDraftField("image", " app:dev ");
      result.current.setDraftField("target", " ghcr.io/me/app:dev ");
    });
    await act(async () => result.current.push());
    expect(result.current.output).toBe("pushed digest sha256:1");

    await act(async () => result.current.tag());
    expect(commands.dockerTagImage).toHaveBeenCalledWith("app:dev", "ghcr.io/me/app:dev");
    expect(result.current.output).toBe("Tagged app:dev as ghcr.io/me/app:dev.");
    expect(onInventoryChanged).toHaveBeenCalledOnce();

    await act(async () => result.current.push());
    expect(result.current.error).toBe("denied");
    await act(async () => result.current.tag());
    expect(result.current.error).toBe("no such image");
  });

  it("keeps only the latest search result", async () => {
    const first = deferred<never[]>();
    const second = deferred<{ name: string }[]>();
    vi.spyOn(commands, "dockerRegistrySearch")
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    const { result } = await renderRegistry();

    await act(async () => result.current.search());
    expect(commands.dockerRegistrySearch).not.toHaveBeenCalled();

    act(() => result.current.setQuery(" redis "));
    let firstSearch!: Promise<void>;
    let secondSearch!: Promise<void>;
    act(() => {
      firstSearch = result.current.search();
    });
    act(() => {
      secondSearch = result.current.search();
    });
    await act(async () => {
      second.resolve([{ name: "redis" }]);
      await secondSearch;
    });
    await act(async () => {
      first.reject(new Error("timeout"));
      await firstSearch;
    });

    expect(commands.dockerRegistrySearch).toHaveBeenCalledWith("redis", 25);
    expect(result.current.results).toEqual([{ name: "redis" }]);
    expect(result.current.error).toBeNull();
    expect(result.current.isBusy).toBe(false);
  });

  it("clears results when the latest search fails", async () => {
    vi.spyOn(commands, "dockerRegistrySearch").mockRejectedValue(new Error("rate limited"));
    const { result } = await renderRegistry();

    act(() => result.current.setQuery("redis"));
    await act(async () => result.current.search());

    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBe("rate limited");
  });
});
