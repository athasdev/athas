import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import type { QueryClient } from "@tanstack/react-query";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import {
  deliveryDetailQuery,
  deliveryKeys,
  deliveryListQuery,
  DELIVERY_PAGE_SIZE,
  notifyDeliveryChanged,
} from "../delivery/services/github-delivery-service";
import { releaseFixture } from "./github-delivery-fixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let client: QueryClient;

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  client = createTestQueryClient();
});

describe("delivery loading", () => {
  it("deduplicates prefetches but isolates repositories", async () => {
    vi.mocked(invoke).mockResolvedValue(releaseFixture);
    await Promise.all([
      client.query(deliveryDetailQuery("releases", "/a", 41)),
      client.query(deliveryDetailQuery("releases", "/a", 41)),
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
    await client.query(deliveryDetailQuery("releases", "/b", 41));
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("requests the right page and does not mix resource types", async () => {
    vi.mocked(invoke).mockResolvedValue(
      Array.from({ length: DELIVERY_PAGE_SIZE }, () => releaseFixture),
    );
    const releases = await client.infiniteQuery({
      ...deliveryListQuery("releases", "/a"),
      pages: 2,
    });
    await client.infiniteQuery(deliveryListQuery("deployments", "/a"));

    expect(releases.pageParams).toEqual([1, 2]);
    expect(invoke).toHaveBeenNthCalledWith(2, "github_list_releases", { repoPath: "/a", page: 2 });
    expect(invoke).toHaveBeenNthCalledWith(3, "github_list_deployments", {
      repoPath: "/a",
      page: 1,
    });
  });

  it("retries failures and bypasses cached data for manual refresh", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("Forbidden").mockResolvedValue([releaseFixture]);
    await expect(client.infiniteQuery(deliveryListQuery("releases", "/a"))).rejects.toBe(
      "Forbidden",
    );
    await client.infiniteQuery(deliveryListQuery("releases", "/a"));
    await client.infiniteQuery(deliveryListQuery("releases", "/a"));
    expect(invoke).toHaveBeenCalledTimes(2);

    notifyDeliveryChanged(client, "releases", "/a", releaseFixture.id);
    expect(client.getQueryState(deliveryKeys.list("releases", "/a"))?.isInvalidated).toBe(true);
    await client.infiniteQuery(deliveryListQuery("releases", "/a"));
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
