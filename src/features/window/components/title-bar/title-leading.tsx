import { toggleWorkbenchSidebar } from "@/features/layout/services/project-tools";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useWorkbenchSidebarStore } from "@/features/layout/stores/workbench-sidebar.store";
import { WindowMenuDropdown } from "@/features/window/components/window-menu-bar";
import { AthasMark } from "@/ui/brand-marks";
import { Button } from "@/ui/button";
import { ControlSizeProvider } from "@/ui/control-size";
import { SidebarIcon } from "@/ui/icons";
import { Toggle } from "@/ui/toggle";
import { TabHistoryNavigation } from "@/features/tabs/components/tab-history-navigation";
import { useLayoutEffect, useRef } from "react";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { cn } from "@/utils/cn";
import { TitleProjectSwitcher } from "./title-project-switcher";
import { IS_MAC, IS_WEB } from "@/utils/platform";

/**
 * The leading end of the title bar, next to the window controls: the app menu (Windows, Linux and
 * the web, where there is no native menu bar), the sidebar toggle, back and forward, then the
 * project switcher.
 *
 * `merged` floats it over the top of the sidebar, in line with the pane headers, for windows
 * without a title row; while the sidebar is hidden it publishes where it ends, so the top-left
 * pane header makes room for it.
 */
export function TitleLeading({
  merged = false,
  narrow = false,
  overFullscreen = false,
  sidebarShown = true,
}: {
  merged?: boolean;
  /** Floats over a full-screen pane, in its top header row. */
  overFullscreen?: boolean;
  /** A narrow window, where the sidebar floats over the centre instead of taking a column. */
  narrow?: boolean;
  sidebarShown?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isSidebarColumnVisible = useUIState((state) => state.isSidebarVisible);
  const isSidebarOverlayOpen = useWorkbenchSidebarStore.use.overlayOpen();
  const isSidebarVisible = narrow ? isSidebarOverlayOpen : isSidebarColumnVisible;
  const toggleSidebarShortcut = useCommandShortcut("workbench.toggleSidebar");

  useLayoutEffect(() => {
    const root = document.documentElement;
    const container = containerRef.current;
    if (!merged || sidebarShown || !container) {
      root.style.removeProperty("--athas-title-leading-end");
      root.style.removeProperty("--athas-title-leading-offset");
      return;
    }
    // A full-screen pane starts at the window edge, not after the activity bar.
    if (overFullscreen) root.style.setProperty("--athas-title-leading-offset", "0px");
    else root.style.removeProperty("--athas-title-leading-offset");
    const publish = () =>
      root.style.setProperty(
        "--athas-title-leading-end",
        `${Math.ceil(container.getBoundingClientRect().right)}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(container);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--athas-title-leading-end");
      root.style.removeProperty("--athas-title-leading-offset");
    };
  }, [merged, overFullscreen, sidebarShown]);

  return (
    <ControlSizeProvider size={IS_MAC ? "sm" : "lg"}>
      <div
        ref={containerRef}
        data-slot="title-leading"
        data-tauri-drag-region
        className={cn(
          "absolute left-0 flex min-w-0 items-center pl-title-bar-leading",
          merged ? "top-workbench z-30 h-pane-header max-w-[50%]" : "inset-y-0 z-10 max-w-[50%]",
          overFullscreen && "z-10050",
          IS_MAC ? "gap-0.5" : "gap-1",
        )}
      >
        {IS_MAC && !IS_WEB ? null : (
          <div className="-ml-0.5 flex shrink-0">
            <WindowMenuDropdown
              trigger={<Button variant="ghost" iconOnly tooltip="Menu" aria-label="Menu" />}
            >
              <AthasMark size="1rem" />
            </WindowMenuDropdown>
          </div>
        )}
        <div className="flex shrink-0">
          <Toggle
            type="button"
            pressed={isSidebarVisible}
            onPressedChange={toggleWorkbenchSidebar}
            tooltip={isSidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
            shortcut={toggleSidebarShortcut}
            aria-label={isSidebarVisible ? "Hide sidebar" : "Show sidebar"}
          >
            <SidebarIcon />
          </Toggle>
        </div>
        <TabHistoryNavigation />
        <TitleProjectSwitcher />
      </div>
    </ControlSizeProvider>
  );
}
