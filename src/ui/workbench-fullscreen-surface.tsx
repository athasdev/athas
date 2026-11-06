import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

/**
 * The layout shell a fullscreen surface mounts into. Rendered where it is declared, the surface
 * would share the stacking context of the pane it came from, and sidebars or rail controls
 * layered above that pane would show through it.
 */
export const WorkbenchFullscreenRootContext = createContext<HTMLElement | null>(null);

/**
 * How the window controls sit while a surface is full screen: `header` inside the surface's own
 * top header row, `title-row` on a title row above it, `none` with no surface full screen.
 */
export type WorkbenchFullscreenMode = "none" | "header" | "title-row";

const mounted = { header: 0, titleRow: 0 };
const listeners = new Set<() => void>();

function getFullscreenMode(): WorkbenchFullscreenMode {
  if (mounted.titleRow > 0) return "title-row";
  return mounted.header > 0 ? "header" : "none";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a surface is full screen now, and where the window controls sit while it is. */
export function useWorkbenchFullscreenMode(): WorkbenchFullscreenMode {
  return useSyncExternalStore(subscribe, getFullscreenMode, () => "none");
}

/**
 * A pane taken full screen: one island over the whole workbench, with the window plane around it
 * as around every other island. The workbench under it is hidden (see `window-transparency.css`),
 * so with glass the window shows in the gutters, not the panes.
 *
 * With `windowControlsInHeader`, the island reaches the top of the window and its own top header
 * row makes room for the window controls, as the top-left pane does in the workbench. Otherwise
 * it starts below the title row, which then carries the controls.
 */
export function WorkbenchFullscreenSurface({
  className,
  style,
  children,
  windowControlsInHeader = false,
  ...props
}: ComponentProps<"div"> & { windowControlsInHeader?: boolean }) {
  const root = useContext(WorkbenchFullscreenRootContext);

  useEffect(() => {
    const key = windowControlsInHeader ? "header" : "titleRow";
    mounted[key] += 1;
    for (const listener of listeners) listener();
    return () => {
      mounted[key] -= 1;
      for (const listener of listeners) listener();
    };
  }, [windowControlsInHeader]);

  const surface = (
    <div
      data-slot="workbench-fullscreen-surface"
      className="fixed inset-x-0 bottom-0 z-10040 flex p-workbench transition-[opacity,scale] duration-normal ease-smooth starting:scale-[0.985] starting:opacity-0 motion-reduce:transition-none"
      style={{
        top: windowControlsInHeader ? 0 : "var(--athas-title-bar-height)",
        ...style,
      }}
      {...props}
    >
      <div
        className={cn(
          "athas-glass-island min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-background shadow-(--shadow-raised)",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );

  return root ? createPortal(surface, root) : surface;
}
