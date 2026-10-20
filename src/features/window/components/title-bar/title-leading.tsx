import { useUIState } from "@/features/layout/stores/ui-state.store";
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
import { IS_MAC, IS_WEB } from "@/utils/platform";

/**
 * The leading end of the title bar, next to the window controls: the app menu (Windows, Linux and
 * the web, where there is no native menu bar), the sidebar toggle, then back and forward. Projects
 * and their branches are shown in the sidebar and the session details.
 *
 * `merged` floats it over the top of the sidebar, in line with the pane headers, for windows
 * without a title row; while the sidebar is hidden it publishes where it ends, so the top-left
 * pane header makes room for it.
 */
export function TitleLeading({
  merged = false,
  sidebarShown = true,
}: {
  merged?: boolean;
  sidebarShown?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const setIsSidebarVisible = useUIState((state) => state.setIsSidebarVisible);
  const toggleSidebarShortcut = useCommandShortcut("workbench.toggleSidebar");

  useLayoutEffect(() => {
    const root = document.documentElement;
    const container = containerRef.current;
    if (!merged || sidebarShown || !container) {
      root.style.removeProperty("--athas-title-leading-end");
      return;
    }
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
    };
  }, [merged, sidebarShown]);

  return (
    <ControlSizeProvider size={IS_MAC ? "sm" : "lg"}>
      <div
        ref={containerRef}
        data-slot="title-leading"
        data-tauri-drag-region
        className={cn(
          "absolute left-0 flex min-w-0 items-center pl-title-bar-leading",
          merged ? "top-workbench z-30 h-pane-header max-w-[50%]" : "inset-y-0 z-10 max-w-[50%]",
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
            onPressedChange={setIsSidebarVisible}
            tooltip={isSidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
            shortcut={toggleSidebarShortcut}
            aria-label={isSidebarVisible ? "Hide sidebar" : "Show sidebar"}
          >
            <SidebarIcon />
          </Toggle>
        </div>
        <TabHistoryNavigation />
      </div>
    </ControlSizeProvider>
  );
}
