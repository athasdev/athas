import { commands } from "@/bindings/commands";

export const createPullRequest = (
  repoPath: string,
  title: string,
  body: string,
  head: string,
  base: string,
  draft: boolean,
  labels: string[],
  assignees: string[],
) => commands.githubCreatePullRequest(repoPath, title, body, head, base, draft, labels, assignees);

export const updatePullRequest = (
  repoPath: string,
  prNumber: number,
  title: string,
  body: string,
  labels: string[],
  assignees: string[],
) => commands.githubUpdatePullRequest(repoPath, prNumber, title, body, labels, assignees);

export const addPullRequestComment = (repoPath: string, prNumber: number, body: string) =>
  commands.githubAddPrComment(repoPath, prNumber, body);

export const submitPullRequestReview = (
  repoPath: string,
  prNumber: number,
  event: string,
  body: string,
) => commands.githubSubmitPrReview(repoPath, prNumber, event, body);

export const mergePullRequest = (repoPath: string, prNumber: number, method: string) =>
  commands.githubMergePullRequest(repoPath, prNumber, method);

export const closePullRequestOnGitHub = (repoPath: string, prNumber: number) =>
  commands.githubClosePullRequest(repoPath, prNumber);
