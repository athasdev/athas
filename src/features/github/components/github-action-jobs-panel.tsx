import { ChevronDownIcon, ChevronRightIcon, CopyIcon, OpenExternalIcon } from "@/ui/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { ContextMenuPopup, createContextMenuGroups } from "@/ui/context-menu";
import { EmptyState } from "@/ui/empty";
import { ScrollArea } from "@/ui/scroll-area";
import { cn } from "@/utils/cn";
import type { WorkflowRunJob } from "../types/github.types";
import {
  formatWorkflowDuration,
  getWorkflowJobTiming,
  getWorkflowRunState,
  getWorkflowStepTiming,
} from "../utils/github-workflow-status";
import { copyToClipboard } from "../utils/github-viewer-utils";
import { WORKFLOW_TONE_TEXT_CLASS, WorkflowStatusIcon } from "./github-workflow-status-icon";

interface JobsContextMenuState {
  point: { x: number; y: number };
  job: WorkflowRunJob;
  stepIndex: number | null;
}

interface GitHubActionJobsPanelProps {
  jobs: WorkflowRunJob[];
  selectedJobId: number | null;
  selectedStepIndex: number | null;
  now: number;
  onSelectJob: (job: WorkflowRunJob) => void;
  onSelectStep: (job: WorkflowRunJob, stepIndex: number) => void;
}

const rowClassName =
  "flex w-full min-w-0 items-center gap-2 rounded-chrome px-2 text-left font-sans ui-text-sm outline-none transition-colors duration-fast hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-primary/20";

export function GitHubActionJobsPanel({
  jobs,
  selectedJobId,
  selectedStepIndex,
  now,
  onSelectJob,
  onSelectStep,
}: GitHubActionJobsPanelProps) {
  const [contextMenu, setContextMenu] = useState<JobsContextMenuState | null>(null);

  if (jobs.length === 0) {
    return <EmptyState className="min-h-32" message="No jobs reported for this run yet" />;
  }

  const openContextMenu = (
    event: React.MouseEvent,
    job: WorkflowRunJob,
    stepIndex: number | null,
  ) => {
    event.preventDefault();
    setContextMenu({ point: { x: event.clientX, y: event.clientY }, job, stepIndex });
  };

  const contextStep =
    contextMenu && contextMenu.stepIndex !== null
      ? (contextMenu.job.steps[contextMenu.stepIndex] ?? null)
      : null;
  const contextGroups = contextMenu
    ? createContextMenuGroups([
        ...(contextStep
          ? [
              {
                id: "copy-step",
                label: "Copy step name",
                icon: <CopyIcon />,
                onClick: () => void copyToClipboard(contextStep.name, "Step name copied"),
              },
            ]
          : []),
        {
          id: "copy-job",
          label: "Copy job name",
          icon: <CopyIcon />,
          onClick: () => void copyToClipboard(contextMenu.job.name, "Job name copied"),
        },
        ...(contextMenu.job.url
          ? [
              { id: "sep", separator: true as const },
              {
                id: "open-job",
                label: "Open job on GitHub",
                icon: <OpenExternalIcon />,
                onClick: () => void openUrl(contextMenu.job.url ?? ""),
              },
              {
                id: "copy-job-link",
                label: "Copy job link",
                onClick: () => void copyToClipboard(contextMenu.job.url ?? "", "Job link copied"),
              },
            ]
          : []),
      ])
    : [];

  return (
    <ScrollArea className="min-h-0 flex-1" contentClassName="p-2">
      <ContextMenuPopup
        isOpen={contextMenu !== null}
        point={contextMenu?.point ?? { x: 0, y: 0 }}
        groups={contextGroups}
        onClose={() => setContextMenu(null)}
      />
      <nav aria-label="Workflow jobs" className="flex flex-col gap-0.5">
        {jobs.map((job, jobIndex) => {
          const isSelected = job.id != null && selectedJobId === job.id;
          const state = getWorkflowRunState(job.status, job.conclusion);
          const duration = formatWorkflowDuration(getWorkflowJobTiming(job, now).durationMs);
          const key = `${job.id ?? job.name}-${jobIndex}`;
          const Chevron = isSelected ? ChevronDownIcon : ChevronRightIcon;

          return (
            <div key={key} className="min-w-0">
              <button
                type="button"
                aria-expanded={isSelected}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelectJob(job)}
                onContextMenu={(event) => openContextMenu(event, job, null)}
                className={cn(
                  rowClassName,
                  "h-8",
                  isSelected ? "bg-accent text-foreground" : "text-foreground",
                )}
              >
                <Chevron className="shrink-0 text-subtle-foreground" />
                <WorkflowStatusIcon
                  status={job.status}
                  conclusion={job.conclusion}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{job.name}</span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    state.isActive ? WORKFLOW_TONE_TEXT_CLASS.accent : "text-subtle-foreground",
                  )}
                >
                  {duration ?? state.label}
                </span>
              </button>

              {isSelected ? (
                <ol className="my-1 ml-3 flex flex-col gap-0.5 border-border/60 border-l pl-1.5">
                  {job.steps.length === 0 ? (
                    <li className="px-2 py-1.5 text-subtle-foreground ui-text-sm">
                      No steps reported
                    </li>
                  ) : (
                    job.steps.map((step, stepIndex) => {
                      const isStepSelected = selectedStepIndex === stepIndex;
                      const stepState = getWorkflowRunState(step.status, step.conclusion);
                      const stepDuration = formatWorkflowDuration(
                        getWorkflowStepTiming(step, now).durationMs,
                      );

                      return (
                        <li key={`${step.name}-${stepIndex}`}>
                          <button
                            type="button"
                            aria-current={isStepSelected ? "true" : undefined}
                            onClick={() => onSelectStep(job, stepIndex)}
                            onContextMenu={(event) => openContextMenu(event, job, stepIndex)}
                            className={cn(
                              rowClassName,
                              "h-7",
                              isStepSelected
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <span className="w-4 shrink-0 text-right tabular-nums text-subtle-foreground ui-text-caption">
                              {step.number ?? stepIndex + 1}
                            </span>
                            <WorkflowStatusIcon
                              status={step.status}
                              conclusion={step.conclusion}
                              className="shrink-0"
                            />
                            <span className="min-w-0 flex-1 truncate">{step.name}</span>
                            {stepDuration ? (
                              <span
                                className={cn(
                                  "shrink-0 tabular-nums text-subtle-foreground",
                                  stepState.isActive && WORKFLOW_TONE_TEXT_CLASS.accent,
                                )}
                              >
                                {stepDuration}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })
                  )}
                </ol>
              ) : null}
            </div>
          );
        })}
      </nav>
    </ScrollArea>
  );
}
