import type { ReactNode } from "react";
import { toggleSidebarView } from "@/features/layout/services/project-tools";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import {
  AGENTS_SIDEBAR_VIEW,
  useWorkbenchSidebarStore,
} from "@/features/layout/stores/workbench-sidebar.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { ControlSizeProvider } from "@/ui/control-size";
import { ChatBubbleTextIcon, IconContext } from "@/ui/icons";
import { OverlaySideProvider } from "@/ui/overlay-side";
import { cn } from "@/utils/cn";
import { useProjectTools } from "../dock/project-tools";

const SOLID_ICON = { filled: true };

function ActivityItem({
  view,
  title,
  icon,
  active,
}: {
  view: string;
  title: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      iconOnly
      active={active}
      aria-pressed={active}
      aria-label={title}
      tooltip={title}
      onClick={() => toggleSidebarView(view)}
    >
      {active ? <IconContext.Provider value={SOLID_ICON}>{icon}</IconContext.Provider> : icon}
    </Button>
  );
}

/**
 * The column down the left edge that picks what the sidebar shows: the agents, then every project
 * tool. Picking the view that already shows puts the sidebar away.
 */
export function ActivityBar({
  narrow,
  titleRow,
  hidden = false,
}: {
  narrow: boolean;
  titleRow: boolean;
  /** Folds away with the sidebar, at the same pace, so the centre moves once. */
  hidden?: boolean;
}) {
  const tools = useProjectTools();
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);
  const activeView = useWorkbenchSidebarStore.use.activeView();
  const sidebarOut = useWorkbenchSidebarStore((state) => state.overlayOpen);
  const sidebarVisible = useUIState((state) => state.isSidebarVisible);
  const shownView = (narrow ? sidebarOut : sidebarVisible) ? activeView : null;

  return (
    <nav
      aria-label="Activity bar"
      aria-hidden={hidden || undefined}
      inert={hidden}
      data-slot="activity-bar"
      className={cn(
        "flex h-full shrink-0 select-none flex-col items-center overflow-hidden transition-[width] duration-fast ease-smooth motion-reduce:transition-none",
        hidden ? "w-0" : "w-activity-bar",
      )}
    >
      {titleRow ? (
        <div aria-hidden data-tauri-drag-region className="h-pane-header w-full shrink-0" />
      ) : null}
      <ControlSizeProvider size="lg">
        <OverlaySideProvider side="right" align="center">
          <div className="scrollbar-none flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pt-1">
            {aiEnabled ? (
              <ActivityItem
                view={AGENTS_SIDEBAR_VIEW}
                title="Agents"
                icon={<ChatBubbleTextIcon />}
                active={shownView === AGENTS_SIDEBAR_VIEW}
              />
            ) : null}
            {tools.map((tool) => (
              <ActivityItem
                key={tool.view}
                view={tool.view}
                title={tool.title}
                icon={tool.icon}
                active={shownView === tool.view}
              />
            ))}
          </div>
        </OverlaySideProvider>
      </ControlSizeProvider>
    </nav>
  );
}
