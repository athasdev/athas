export const ONBOARDING_CHECKLIST_TASKS = [
  { id: "open-project", label: "Open a project" },
  { id: "start-agent", label: "Try the Agent" },
  { id: "open-terminal", label: "Open a terminal" },
  { id: "open-command-palette", label: "Find a command" },
  { id: "open-settings", label: "Customize Athas" },
] as const;

export type OnboardingChecklistTaskId = (typeof ONBOARDING_CHECKLIST_TASKS)[number]["id"];

const ONBOARDING_CHECKLIST_TASK_IDS = new Set<OnboardingChecklistTaskId>(
  ONBOARDING_CHECKLIST_TASKS.map((task) => task.id),
);

export function isOnboardingChecklistTaskId(value: unknown): value is OnboardingChecklistTaskId {
  return (
    typeof value === "string" &&
    ONBOARDING_CHECKLIST_TASK_IDS.has(value as OnboardingChecklistTaskId)
  );
}

export function getOnboardingChecklistProgress(completedTaskIds: OnboardingChecklistTaskId[]) {
  const completedIds = new Set(completedTaskIds);
  const completedCount = ONBOARDING_CHECKLIST_TASKS.filter((task) =>
    completedIds.has(task.id),
  ).length;
  const totalCount = ONBOARDING_CHECKLIST_TASKS.length;

  return {
    completedCount,
    totalCount,
    percentage: (completedCount / totalCount) * 100,
    complete: completedCount === totalCount,
  };
}
