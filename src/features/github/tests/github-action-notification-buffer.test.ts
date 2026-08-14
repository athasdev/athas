import { describe, expect, it } from "vite-plus/test";
import { createPaneContent } from "@/features/editor/stores/buffer-content-factory";

describe("GitHub action notification buffers", () => {
  it("creates a native pending action buffer before a workflow run is resolved", () => {
    const content = createPaneContent("buffer-1", {
      type: "githubAction",
      repoPath: "github://athasdev/athas",
      name: "CI workflow run",
      notification: {
        id: "notification-1",
        repositoryFullName: "athasdev/athas",
        checkSuiteId: 501857806,
        title: "CI workflow run",
        updatedAt: "2026-08-14T12:00:00Z",
      },
    });

    expect(content).toMatchObject({
      type: "githubAction",
      path: "github-action-notification://notification-1",
      runId: undefined,
      notification: { id: "notification-1" },
    });
  });
});
