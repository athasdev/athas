import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import {
  useWorkspaceTabsStore,
  type ProjectTab,
} from "@/features/window/stores/workspace-tabs.store";
import { prepareWorkspaceRuntime } from "@/features/workspace/services/workspace-lifecycle";

interface ScheduleWorkspacePrewarmOptions {
  initialize: (workspaceId: string, path: string, name: string) => Promise<boolean>;
  isEligible: (tab: ProjectTab) => boolean;
  waitForIdle: () => Promise<void>;
  onPrepared?: (tab: ProjectTab, prepared: boolean, durationMs: number) => void;
}

let pendingWorkspacePrewarm: Promise<void> | null = null;

export const orderWorkspacePrewarmCandidates = (
  tabs: ProjectTab[],
  activeWorkspaceId: string,
  isEligible: (tab: ProjectTab) => boolean,
) => {
  const activeIndex = tabs.findIndex((tab) => tab.id === activeWorkspaceId);
  return tabs
    .map((tab, index) => ({ tab, index }))
    .filter(
      ({ tab }) =>
        tab.id !== activeWorkspaceId &&
        isEligible(tab) &&
        !workspaceRuntimeRegistry.isWorkspaceReady(tab.id),
    )
    .sort((left, right) => Math.abs(left.index - activeIndex) - Math.abs(right.index - activeIndex))
    .map(({ tab }) => tab);
};

export const scheduleWorkspacePrewarm = ({
  initialize,
  isEligible,
  waitForIdle,
  onPrepared,
}: ScheduleWorkspacePrewarmOptions) => {
  if (pendingWorkspacePrewarm) {
    return pendingWorkspacePrewarm;
  }

  pendingWorkspacePrewarm = (async () => {
    await waitForIdle();

    const candidates = orderWorkspacePrewarmCandidates(
      useWorkspaceTabsStore.getState().projectTabs,
      workspaceRuntimeRegistry.getActiveWorkspaceId(),
      isEligible,
    );

    for (const tab of candidates) {
      if (
        !useWorkspaceTabsStore
          .getState()
          .projectTabs.some((candidate) => candidate.id === tab.id) ||
        workspaceRuntimeRegistry.isWorkspaceReady(tab.id)
      ) {
        continue;
      }

      const startedAt = performance.now();
      const prepared = await prepareWorkspaceRuntime({
        descriptor: { id: tab.id, name: tab.name, path: tab.path },
        initialize,
      });
      onPrepared?.(tab, prepared, performance.now() - startedAt);
      await waitForIdle();
    }
  })().finally(() => {
    pendingWorkspacePrewarm = null;
  });

  return pendingWorkspacePrewarm;
};
