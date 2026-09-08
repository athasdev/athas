import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import {
  deliveryDetailCache,
  deliveryListCache,
  loadDeliveryDetail,
  loadDeliveryPage,
} from "../delivery/services/github-delivery-service";
import { releaseFixture } from "./github-delivery-fixtures";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  deliveryDetailCache.clear();
  deliveryListCache.clear();
});
describe("delivery loading", () => {
  it("deduplicates prefetches but isolates repositories", async () => {
    vi.mocked(invoke).mockResolvedValue(releaseFixture);
    await Promise.all([
      loadDeliveryDetail("releases", "/a", 41),
      loadDeliveryDetail("releases", "/a", 41),
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
    await loadDeliveryDetail("releases", "/b", 41);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("requests the right page and does not mix resource types", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await loadDeliveryPage("releases", "/a", 2);
    await loadDeliveryPage("deployments", "/a", 2);
    expect(invoke).toHaveBeenNthCalledWith(1, "github_list_releases", { repoPath: "/a", page: 2 });
    expect(invoke).toHaveBeenNthCalledWith(2, "github_list_deployments", {
      repoPath: "/a",
      page: 2,
    });
  });
  it("retries failures and bypasses cached data for manual refresh", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("Forbidden").mockResolvedValue([releaseFixture]);
    await expect(loadDeliveryPage("releases", "/a", 1)).rejects.toBe("Forbidden");
    await loadDeliveryPage("releases", "/a", 1);
    await loadDeliveryPage("releases", "/a", 1);
    expect(invoke).toHaveBeenCalledTimes(2);
    await loadDeliveryPage("releases", "/a", 1, true);
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
