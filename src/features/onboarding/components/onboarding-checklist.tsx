import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getOnboardingChecklistProgress,
  ONBOARDING_CHECKLIST_TASKS,
  type OnboardingChecklistTaskId,
} from "@/features/onboarding/lib/onboarding-checklist";
import { useOnboardingChecklistStore } from "@/features/onboarding/stores/onboarding-checklist.store";
import { CaretDownIcon, CheckCircleIcon, CircleIcon } from "@/ui/icons";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/ui/popover";
import { ProgressCircle } from "@/ui/progress";
import { SidebarIconButton, SidebarListItem } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

interface OnboardingChecklistProps {
  expanded: boolean;
  hasProject: boolean;
  onOpenProject: () => void;
  onStartAgent: () => void;
  onOpenTerminal: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
}

interface ChecklistTask {
  id: OnboardingChecklistTaskId;
  label: string;
  action: () => void;
}

function ChecklistItems({
  tasks,
  completedTaskIds,
  onSelect,
}: {
  tasks: ChecklistTask[];
  completedTaskIds: Set<OnboardingChecklistTaskId>;
  onSelect: (task: ChecklistTask) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-chrome-tight">
      {tasks.map((task) => {
        const completed = completedTaskIds.has(task.id);

        return (
          <SidebarListItem
            key={task.id}
            leading={
              completed ? (
                <CheckCircleIcon className="text-success" />
              ) : (
                <CircleIcon className="text-subtle-foreground/70" />
              )
            }
            onClick={() => onSelect(task)}
            aria-label={`${task.label}${completed ? ", completed" : ""}`}
          >
            {task.label}
          </SidebarListItem>
        );
      })}
    </div>
  );
}

function ChecklistBody({
  tasks,
  completedTaskIds,
  onSelect,
  header,
}: {
  tasks: ChecklistTask[];
  completedTaskIds: Set<OnboardingChecklistTaskId>;
  onSelect: (task: ChecklistTask) => void;
  header?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-chrome">
      {header}
      <ChecklistItems tasks={tasks} completedTaskIds={completedTaskIds} onSelect={onSelect} />
    </div>
  );
}

export function OnboardingChecklist({
  expanded,
  hasProject,
  onOpenProject,
  onStartAgent,
  onOpenTerminal,
  onOpenCommandPalette,
  onOpenSettings,
}: OnboardingChecklistProps) {
  const [isOpen, setIsOpen] = useState(false);
  const completedTaskIds = useOnboardingChecklistStore.use.completedTaskIds();
  const completeTask = useOnboardingChecklistStore.use.actions().completeTask;
  const taskActions = useMemo<Record<OnboardingChecklistTaskId, () => void>>(
    () => ({
      "open-project": onOpenProject,
      "start-agent": onStartAgent,
      "open-terminal": onOpenTerminal,
      "open-command-palette": onOpenCommandPalette,
      "open-settings": onOpenSettings,
    }),
    [onOpenCommandPalette, onOpenProject, onOpenSettings, onOpenTerminal, onStartAgent],
  );
  const tasks = useMemo<ChecklistTask[]>(
    () => ONBOARDING_CHECKLIST_TASKS.map((task) => ({ ...task, action: taskActions[task.id] })),
    [taskActions],
  );

  useEffect(() => {
    if (hasProject) completeTask("open-project");
  }, [completeTask, hasProject]);

  const completedIds = useMemo(() => new Set(completedTaskIds), [completedTaskIds]);
  const progress = getOnboardingChecklistProgress(completedTaskIds);
  const progressLabel = `${progress.completedCount} of ${progress.totalCount} complete`;
  const handleSelect = (task: ChecklistTask) => {
    task.action();
    if (task.id !== "open-project") completeTask(task.id);
    if (!expanded) setIsOpen(false);
  };

  if (progress.complete) return null;

  if (!expanded) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger
          render={
            <SidebarIconButton
              active={isOpen}
              tooltip={`Getting started, ${progressLabel}`}
              aria-label={`Getting started, ${progressLabel}`}
            />
          }
        >
          <ProgressCircle value={progress.percentage} />
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-64">
          <ChecklistBody
            tasks={tasks}
            completedTaskIds={completedIds}
            onSelect={handleSelect}
            header={
              <PopoverHeader>
                <div className="flex items-center justify-between gap-chrome">
                  <PopoverTitle>Getting started</PopoverTitle>
                  <span className="tabular-nums text-subtle-foreground">{progressLabel}</span>
                </div>
              </PopoverHeader>
            }
          />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className="w-full">
      <SidebarListItem
        active={isOpen}
        leading={<ProgressCircle value={progress.percentage} />}
        trailing={
          <span className="flex items-center gap-chrome-tight">
            <span className="tabular-nums">
              {progress.completedCount}/{progress.totalCount}
            </span>
            <CaretDownIcon
              className={cn("transition-transform duration-fast", !isOpen && "-rotate-90")}
            />
          </span>
        }
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls="activity-onboarding-checklist"
      >
        Getting started
      </SidebarListItem>
      {isOpen ? (
        <div id="activity-onboarding-checklist" className="pt-chrome-tight pl-chrome">
          <ChecklistBody tasks={tasks} completedTaskIds={completedIds} onSelect={handleSelect} />
        </div>
      ) : null}
    </div>
  );
}
