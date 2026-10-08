import { commands } from "@/bindings/commands";

export const listIssues = (repoPath: string, state: string | null) =>
  commands.githubListIssues(repoPath, state);

export const fetchIssueDetails = (repoPath: string, issueNumber: number) =>
  commands.githubGetIssueDetails(repoPath, issueNumber);

export const listRepositoryLabels = (repoPath: string) => commands.githubListLabels(repoPath);

export const listRepositoryMilestones = (repoPath: string) =>
  commands.githubListMilestones(repoPath);

export const listRepositoryIssueTypes = (repoPath: string) =>
  commands.githubListIssueTypes(repoPath);

export const createIssue = (
  repoPath: string,
  title: string,
  body: string,
  labels: string[],
  assignees: string[],
  milestone: number | null,
  issueType: string | null,
) => commands.githubCreateIssue(repoPath, title, body, labels, assignees, milestone, issueType);

export const editIssue = (
  repoPath: string,
  issueNumber: number,
  title: string,
  body: string,
  labels: string[],
  assignees: string[],
  milestone: number | null,
  issueType: string | null,
) =>
  commands.githubUpdateIssue(
    repoPath,
    issueNumber,
    title,
    body,
    labels,
    assignees,
    milestone,
    issueType,
  );

export const setIssueState = (
  repoPath: string,
  issueNumber: number,
  state: string,
  stateReason: string | null,
) => commands.githubUpdateIssueState(repoPath, issueNumber, state, stateReason);

export const lockIssue = (repoPath: string, issueNumber: number, lockReason: string | null) =>
  commands.githubLockIssue(repoPath, issueNumber, lockReason);

export const unlockIssue = (repoPath: string, issueNumber: number) =>
  commands.githubUnlockIssue(repoPath, issueNumber);

export const addIssueComment = (repoPath: string, issueNumber: number, body: string) =>
  commands.githubAddIssueComment(repoPath, issueNumber, body);

export const updateIssueComment = (repoPath: string, commentId: number, body: string) =>
  commands.githubUpdateIssueComment(repoPath, commentId, body);

export const deleteIssueComment = (repoPath: string, commentId: number) =>
  commands.githubDeleteIssueComment(repoPath, commentId);
