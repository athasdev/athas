import { createContext, useContext, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

/**
 * The layout shell a fullscreen surface mounts into. Rendered where it is declared, the surface
 * would share the stacking context of the pane it came from, and sidebars or rail controls
 * layered above that pane would show through it.
 */
export const WorkbenchFullscreenRootContext = createContext<HTMLElement | null>(null);

export function WorkbenchFullscreenSurface({ className, style, ...props }: ComponentProps<"div">) {
  const root = useContext(WorkbenchFullscreenRootContext);
  const surface = (
    <div
      data-slot="workbench-fullscreen-surface"
      className={cn(
        "fixed inset-x-0 bottom-0 z-10040 overflow-hidden bg-background transition-[opacity,scale] duration-normal ease-smooth starting:scale-[0.985] starting:opacity-0 motion-reduce:transition-none",
        className,
      )}
      // Starts below the title bar, which stays on top of the workbench.
      style={{
        top: "var(--athas-title-bar-height)",
        ...style,
      }}
      {...props}
    />
  );

  return root ? createPortal(surface, root) : surface;
}
