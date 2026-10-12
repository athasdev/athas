// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { createQueryWrapper, createTestQueryClient } from "@/utils/tests/query-test-client";
import { useDeliveryDetail } from "../delivery/hooks/use-delivery-detail";
import { useDeliveryList } from "../delivery/hooks/use-delivery-list";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let client: QueryClient;
let roots: Root[] = [];

function renderHook<T>(useHook: () => T) {
  const result = {} as { current: T };
  const Wrapper = createQueryWrapper(client);
  function Probe() {
    result.current = useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(createElement(Wrapper, null, createElement(Probe))));
  return result;
}

const release = (id: number) => ({ id, tag_name: `v${id}`, immutable: null }) as never;

beforeEach(() => {
  client = createTestQueryClient();
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  client.clear();
  vi.restoreAllMocks();
});

describe("useDeliveryList", () => {
  it("loads pages and drops items repeated across page boundaries", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => release(40 - index));
    const list = vi
      .spyOn(commands, "githubListReleases")
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([release(21), release(20)]);

    const result = renderHook(() => useDeliveryList("releases", "/repo", true));
    await vi.waitFor(() => expect(result.current.items).toHaveLength(20));
    expect(result.current.hasMore).toBe(true);
    expect(result.current.items[0]).toMatchObject({ id: 40, immutable: false });

    act(() => result.current.loadMore());
    await vi.waitFor(() => expect(result.current.items).toHaveLength(21));
    act(() => result.current.loadMore());

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith("/repo", 2);
    expect(result.current.items[result.current.items.length - 1]).toMatchObject({ id: 20 });
    expect(result.current.hasMore).toBe(false);
  });

  it("ignores a second load request while the next page is loading", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => release(40 - index));
    const list = vi
      .spyOn(commands, "githubListReleases")
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([release(20)]);

    const result = renderHook(() => useDeliveryList("releases", "/repo", true));
    await vi.waitFor(() => expect(result.current.items).toHaveLength(20));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });

    await vi.waitFor(() => expect(result.current.items).toHaveLength(21));
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith("/repo", 2);
  });

  it("does not load while disabled and reports failures", async () => {
    const list = vi
      .spyOn(commands, "githubListDeployments")
      .mockRejectedValue(new Error("Resource not accessible"));

    const disabled = renderHook(() => useDeliveryList("deployments", "/repo", false));
    expect(disabled.current.items).toEqual([]);
    expect(list).not.toHaveBeenCalled();

    const enabled = renderHook(() => useDeliveryList("deployments", "/other", true));
    await vi.waitFor(() => expect(enabled.current.error).toBe("Resource not accessible"));
    expect(enabled.current.loading).toBe(false);
  });

  it("refetches on refresh", async () => {
    const list = vi.spyOn(commands, "githubListReleases").mockResolvedValue([release(1)]);
    const result = renderHook(() => useDeliveryList("releases", "/repo", true));
    await vi.waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.refresh());

    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe("useDeliveryDetail", () => {
  it("loads a deployment with defaults for missing fields", async () => {
    vi.spyOn(commands, "githubGetDeployment").mockResolvedValue({
      id: 9,
      environment: "production",
      transient_environment: null,
      production_environment: null,
      statuses: null,
      status_error: null,
    } as never);

    const result = renderHook(() => useDeliveryDetail("deployments", "/repo", 9, true));

    await vi.waitFor(() =>
      expect(result.current.data).toMatchObject({
        id: 9,
        transient_environment: false,
        production_environment: false,
        statuses: [],
        status_error: null,
      }),
    );
    expect(result.current.error).toBeNull();
  });

  it("loads releases, reports errors and waits for a selection", async () => {
    vi.spyOn(commands, "githubGetRelease")
      .mockResolvedValueOnce(release(3))
      .mockRejectedValueOnce("Not Found");

    const none = renderHook(() => useDeliveryDetail("releases", "/repo", undefined, false));
    expect(none.current).toMatchObject({ data: null, loading: false });

    const found = renderHook(() => useDeliveryDetail("releases", "/repo", 3, false));
    await vi.waitFor(() => expect(found.current.data).toMatchObject({ id: 3 }));

    const missing = renderHook(() => useDeliveryDetail("releases", "/repo", 4, false));
    await vi.waitFor(() => expect(missing.current.error).toBe("Not Found"));

    act(() => found.current.refresh());
    await vi.waitFor(() => expect(commands.githubGetRelease).toHaveBeenCalledTimes(3));
  });
});
