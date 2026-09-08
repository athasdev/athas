import { describe, expect, it } from "vite-plus/test";
import {
  deliveryBufferPath,
  deploymentState,
  groupDelivery,
  matchesDelivery,
  safeDeliveryUrl,
} from "../delivery/utils/github-delivery";
import { deploymentFixture, releaseFixture } from "./github-delivery-fixtures";

describe("GitHub delivery", () => {
  it("does not confuse draft prereleases with published prereleases", () => {
    const draft = { ...releaseFixture, draft: true, prerelease: true };
    expect(matchesDelivery(draft, "prerelease", "")).toBe(false);
    expect(matchesDelivery(draft, "draft", "")).toBe(true);
    expect(matchesDelivery(draft, "published", "")).toBe(false);
    expect(matchesDelivery({ ...draft, draft: false }, "prerelease", "")).toBe(true);
  });
  it("searches asset names and deployment commits", () => {
    expect(matchesDelivery(releaseFixture, "all", "AARCH64")).toBe(true);
    expect(matchesDelivery(deploymentFixture, "all", "ABC1234")).toBe(true);
    expect(matchesDelivery(deploymentFixture, "all", "staging")).toBe(false);
  });
  it("keeps absent and failed status requests distinct", () => {
    const missing = { ...deploymentFixture, statuses: [] };
    const failed = { ...deploymentFixture, status_error: "Access denied" };
    expect(deploymentState(missing).label).toBe("Awaiting status");
    expect(matchesDelivery(missing, "active", "")).toBe(false);
    expect(matchesDelivery(missing, "pending", "")).toBe(true);
    expect(deploymentState(failed).label).toBe("Status unavailable");
    expect(matchesDelivery(failed, "active", "")).toBe(false);
    expect(matchesDelivery(failed, "pending", "")).toBe(false);
    expect(matchesDelivery(failed, "all", "")).toBe(true);
  });
  it("uses only the latest deployment status", () => {
    expect(matchesDelivery(deploymentFixture, "pending", "")).toBe(false);
    expect(matchesDelivery(deploymentFixture, "active", "")).toBe(true);
    expect(
      matchesDelivery(
        {
          ...deploymentFixture,
          statuses: [{ ...deploymentFixture.statuses[0], state: "inactive" }],
        },
        "inactive",
        "",
      ),
    ).toBe(true);
  });
  it("groups releases by date regardless of channel, and deployments regardless of environment", () => {
    const releases = groupDelivery([
      { ...releaseFixture, id: 42, prerelease: true, published_at: "2026-09-08T12:00:00" },
      { ...releaseFixture, published_at: "2026-09-08T10:00:00" },
      {
        ...releaseFixture,
        id: 43,
        draft: true,
        published_at: null,
        created_at: "2026-09-07T10:00:00",
      },
    ]);
    expect(releases.map((group) => group.items.map((item) => item.id))).toEqual([[42, 41], [43]]);
    expect(
      groupDelivery([
        { ...deploymentFixture, created_at: "2026-09-08T10:00:00" },
        { ...deploymentFixture, id: 44, environment: "Preview", created_at: "2026-09-08T12:00:00" },
      ]),
    ).toHaveLength(1);
  });
  it("rejects executable and credential-bearing deployment links", () => {
    for (const value of [
      "javascript:alert(1)",
      "file:///tmp/app",
      "data:text/html,x",
      "https://user:secret@example.com",
      "not a url",
    ])
      expect(safeDeliveryUrl(value)).toBeNull();
    expect(safeDeliveryUrl("https://athas.dev/preview")).toBe("https://athas.dev/preview");
  });
  it("includes repository and kind in tab identity", () => {
    expect(deliveryBufferPath("releases", "/a", 42)).not.toBe(
      deliveryBufferPath("releases", "/b", 42),
    );
    expect(deliveryBufferPath("releases", "/a", 42)).not.toBe(
      deliveryBufferPath("deployments", "/a", 42),
    );
  });
});
