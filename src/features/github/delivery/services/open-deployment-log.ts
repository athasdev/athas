import { openUrl } from "@tauri-apps/plugin-opener";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { parseGitHubEntityLink } from "../../utils/github-link-utils";
import { safeDeliveryUrl } from "../utils/github-delivery";

export async function openDeploymentLog(value: string) {
  const url = safeDeliveryUrl(value);
  if (!url) return;
  const target = parseGitHubEntityLink(url);
  if (target?.kind === "actionRun") {
    useBufferStore.getState().actions.openGitHubActionBuffer({
      repoPath: `github://${target.owner}/${target.repo}`,
      runId: target.runId,
      url: target.url,
      title: "Deployment workflow",
    });
    return;
  }
  await openUrl(url);
}
