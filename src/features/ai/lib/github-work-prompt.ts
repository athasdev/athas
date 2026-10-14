import type { GitHubWorkItem } from "@/features/github/utils/github-work-suggestions";

const MAX_BODY_LENGTH = 4000;

export type PullRequestBranchState = "checked-out" | "already-on-branch" | "dirty" | "failed";

interface GitHubWorkPromptContext {
  body?: string | null;
  branch?: PullRequestBranchState;
}

function describeBranch(
  item: Extract<GitHubWorkItem, { kind: "pull-request" }>,
  state?: PullRequestBranchState,
) {
  const branch = `\`${item.headRef}\``;
  switch (state) {
    case "checked-out":
      return `Athas checked out ${branch} (into \`${item.baseRef}\`) for this session.`;
    case "already-on-branch":
      return `The workspace is already on ${branch} (into \`${item.baseRef}\`).`;
    case "dirty":
      return `The pull request branch is ${branch}. The working tree has uncommitted changes, so Athas did not switch to it; ask before switching branches.`;
    default:
      return `The pull request branch is ${branch} (into \`${item.baseRef}\`). Check it out with \`gh pr checkout ${item.number}\` before making changes.`;
  }
}

/** The first message of an agent session started from a GitHub pull request or issue. */
export function buildGitHubWorkPrompt(
  item: GitHubWorkItem,
  { body, branch }: GitHubWorkPromptContext = {},
): string {
  const heading =
    item.kind === "pull-request"
      ? `Work on pull request #${item.number}: ${item.title}`
      : `Work on issue #${item.number}: ${item.title}`;
  const lines = [heading, item.url];
  if (item.kind === "pull-request") lines.push("", describeBranch(item, branch));

  const trimmedBody = body?.trim();
  if (trimmedBody) {
    const clipped =
      trimmedBody.length > MAX_BODY_LENGTH
        ? `${trimmedBody.slice(0, MAX_BODY_LENGTH)}\n\n[Description shortened; read the rest at the link above.]`
        : trimmedBody;
    lines.push("", "Description:", clipped);
  }
  return lines.join("\n");
}
