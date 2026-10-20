import { createContext, useContext, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

/**
 * The layout shell a fullscreen surface mounts into. Rendered where it is declared, the surface
 * would share the stacking context of the pane it came from, and sidebars or rail controls
 * layered above that pane would show through it.
 */
export const WorkbenchFullscreenRootContext = createContext<HTMLElement | null>(null);

/**
 * A pane taken full screen: one island over the whole workbench, below the title row, with the
 * window plane around it as around every other island. The workbench under it is hidden (see
 * `window-transparency.css`), so with glass the window shows in the gutters, not the panes.
 */
export function WorkbenchFullscreenSurface({
  className,
  style,
  children,
  ...props
}: ComponentProps<"div">) {
  const root = useContext(WorkbenchFullscreenRootContext);
  const surface = (
    <div
      data-slot="workbench-fullscreen-surface"
      className="fixed inset-x-0 bottom-0 z-10040 flex p-workbench transition-[opacity,scale] duration-normal ease-smooth starting:scale-[0.985] starting:opacity-0 motion-reduce:transition-none"
      // Starts below the title row, which stays on top of the workbench.
      style={{
        top: "var(--athas-title-bar-height)",
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
