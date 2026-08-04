export const ATHAS_OPEN_PULL_REQUEST_TOOL = "athas_open_pull_request";
export const ATHAS_OPEN_ISSUE_TOOL = "athas_open_issue";
export const ATHAS_SET_CHAT_TITLE_TOOL = "athas_set_chat_title";

interface PullRequestMetadata {
  title?: string;
  repoPath: string;
  initialView: "activity";
}

interface IssueMetadata {
  issueNumber: number;
  title?: string;
  repoPath: string;
}

interface CodexDynamicToolResult {
  contentItems: Array<{ type: "inputText"; text: string }>;
  success: boolean;
}

interface CodexDynamicToolOptions {
  projectRoot: string;
  openPullRequest: (pullRequestNumber: number, metadata: PullRequestMetadata) => string;
  openIssue: (metadata: IssueMetadata) => string;
  setChatTitle: (title: string) => boolean;
}

const toolResult = (text: string, success: boolean): CodexDynamicToolResult => ({
  contentItems: [{ type: "inputText", text }],
  success,
});

export function runCodexDynamicTool(
  tool: string,
  args: unknown,
  options: CodexDynamicToolOptions,
): CodexDynamicToolResult | null {
  if (tool === ATHAS_SET_CHAT_TITLE_TOOL) {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return toolResult("A chat title is required.", false);
    }

    const input = args as Record<string, unknown>;
    const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
    if (!title) return toolResult("A chat title is required.", false);

    if (!options.setChatTitle(title.slice(0, 80))) {
      return toolResult("The Athas chat is no longer available.", false);
    }
    return toolResult(`Athas chat renamed to "${title.slice(0, 80)}".`, true);
  }

  const isPullRequest = tool === ATHAS_OPEN_PULL_REQUEST_TOOL;
  const isIssue = tool === ATHAS_OPEN_ISSUE_TOOL;
  if (!isPullRequest && !isIssue) return null;

  const resourceName = isPullRequest ? "pull request" : "issue";

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return toolResult(`A ${resourceName} number is required.`, false);
  }

  const input = args as Record<string, unknown>;
  const requestedNumber = input.number;
  if (!Number.isInteger(requestedNumber) || Number(requestedNumber) < 1) {
    return toolResult(`The ${resourceName} number must be a positive integer.`, false);
  }

  const title = typeof input.title === "string" ? input.title.trim() || undefined : undefined;
  const resourceNumber = Number(requestedNumber);
  if (isPullRequest) {
    options.openPullRequest(resourceNumber, {
      repoPath: options.projectRoot,
      title,
      initialView: "activity",
    });
  } else {
    options.openIssue({
      issueNumber: resourceNumber,
      repoPath: options.projectRoot,
      title,
    });
  }

  const label = isPullRequest ? "Pull request" : "Issue";
  return toolResult(`${label} #${resourceNumber} opened in Athas.`, true);
}
