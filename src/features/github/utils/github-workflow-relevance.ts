import type { PullRequestDetails } from "../types/github.types";
import type { WorkflowRunChange } from "./github-workflow-run-changes";

type PullRequestParticipants = Pick<PullRequestDetails, "author" | "assignees" | "reviewRequests">;

export async function filterRelevantWorkflowChanges(
  changes: WorkflowRunChange[],
  currentUser: string | null,
  loadPullRequest: (number: number) => Promise<PullRequestParticipants>,
): Promise<WorkflowRunChange[]> {
  if (!currentUser) return [];
  const matchesUser = (login?: string) => login?.toLowerCase() === currentUser.toLowerCase();
  const requests = new Map<number, Promise<boolean>>();
  const isRelevantPullRequest = (number: number) => {
    let request = requests.get(number);
    if (!request) {
      request = loadPullRequest(number)
        .then(
          (pr) =>
            matchesUser(pr.author.login) ||
            pr.assignees.some((user) => matchesUser(user.login)) ||
            pr.reviewRequests.some((user) => matchesUser(user.login)),
        )
        .catch(() => false);
      requests.set(number, request);
    }
    return request;
  };
  const relevant = await Promise.all(
    changes.map(async ({ run }) => {
      if (matchesUser(run.actor?.login) || matchesUser(run.triggeringActor?.login)) return true;
      return (await Promise.all((run.pullRequestNumbers ?? []).map(isRelevantPullRequest))).some(
        Boolean,
      );
    }),
  );
  return changes.filter((change, index) => relevant[index]);
}
