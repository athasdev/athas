import { commands } from "@/bindings/commands";

export const listWorkflows = (repoPath: string) => commands.githubListWorkflows(repoPath);

export const dispatchWorkflow = (repoPath: string, workflowId: number, reference: string) =>
  commands.githubDispatchWorkflow(repoPath, workflowId, reference);

export const fetchWorkflowRunDetails = (repoPath: string, runId: number) =>
  commands.githubGetWorkflowRunDetails(repoPath, runId);

export const fetchWorkflowJobLogs = (repoPath: string, jobId: number) =>
  commands.githubGetWorkflowJobLogs(repoPath, jobId);

export const resolveNotificationWorkflowRun = (
  repositoryFullName: string,
  checkSuiteId: number | null,
  notificationTitle: string,
  notificationUpdatedAt: string,
) =>
  commands.githubResolveNotificationWorkflowRun(
    repositoryFullName,
    checkSuiteId,
    notificationTitle,
    notificationUpdatedAt,
  );

export const rerunWorkflowRun = (repoPath: string, runId: number, failedJobsOnly: boolean) =>
  commands.githubRerunWorkflowRun(repoPath, runId, failedJobsOnly);

export const cancelWorkflowRun = (repoPath: string, runId: number) =>
  commands.githubCancelWorkflowRun(repoPath, runId);
