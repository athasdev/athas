import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/bindings/commands";
import { emitGitChanged } from "@/features/git/events/git-events";
import { queryClient } from "@/utils/query-client";
import { githubKeys } from "./github-queries";
import type { PullRequestDetails } from "../types/github.types";

export async function openPullRequestInBrowser(repoPath: string, prNumber: number) {
  try {
    const cachedUrl = queryClient.getQueryData<PullRequestDetails>(
      githubKeys.pullRequest(repoPath, prNumber),
    )?.url;
    const url = cachedUrl || (await commands.githubGetPrDetails(repoPath, prNumber)).url;

    if (url.startsWith("https://github.com/")) {
      await openUrl(url);
    }
  } catch (err) {
    console.error("Failed to open PR:", err);
  }
}

export async function checkoutPullRequest(repoPath: string, prNumber: number) {
  await commands.githubCheckoutPr(repoPath, prNumber);
  emitGitChanged({
    repoPath,
    scopes: ["working-tree", "history", "refs"],
    source: "checkout-pull-request",
  });
}
