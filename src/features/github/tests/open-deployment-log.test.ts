import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openDeploymentLog } from "../delivery/services/open-deployment-log";
const { openGitHubActionBuffer } = vi.hoisted(() => ({ openGitHubActionBuffer: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ actions: { openGitHubActionBuffer } }) },
}));
beforeEach(() => vi.clearAllMocks());
describe("deployment logs", () => {
  it("opens GitHub workflow logs natively in the URL's repository", async () => {
    await openDeploymentLog("https://github.com/another/repo/actions/runs/123/job/456");
    expect(openGitHubActionBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: "github://another/repo", runId: 123 }),
    );
    expect(openUrl).not.toHaveBeenCalled();
  });
  it("opens external provider logs in the browser", async () => {
    await openDeploymentLog("https://vercel.com/team/project/deployment");
    expect(openUrl).toHaveBeenCalledWith("https://vercel.com/team/project/deployment");
    expect(openGitHubActionBuffer).not.toHaveBeenCalled();
  });
  it("does not open executable URLs", async () => {
    await openDeploymentLog("javascript:alert(1)");
    expect(openUrl).not.toHaveBeenCalled();
    expect(openGitHubActionBuffer).not.toHaveBeenCalled();
  });
});
