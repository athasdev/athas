import { Tooltip as TooltipPrimitive } from "@base-ui/react";
import type React from "react";
import Keybinding from "@/features/keymaps/components/keybinding";
import { useOverlayPlacement } from "@/ui/overlay-side";
import { cn } from "@/utils/cn";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  shortcut?: string;
  width?: "content" | "full" | "grow" | null;
}

interface AnchoredTooltipProps extends Omit<TooltipProps, "children"> {
  anchor: Element | null;
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delay={150} timeout={100} closeDelay={0}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

function TooltipContent({
  anchor,
  content,
  shortcut,
}: Pick<TooltipProps, "content" | "shortcut"> & { anchor?: Element }) {
  const placement = useOverlayPlacement();
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        anchor={anchor}
        side={placement.side ?? "top"}
        sideOffset={4}
        collisionPadding={8}
        positionMethod={anchor ? "fixed" : undefined}
        className="z-99999"
      >
        <TooltipPrimitive.Popup
          className={cn(
            "pointer-events-none z-99999 whitespace-nowrap rounded-md bg-overlay px-2 py-1 font-sans ui-text-chrome text-foreground shadow-(--shadow-popover) ring-1 ring-border transition-[opacity,transform] duration-fast ease-smooth data-instant:transition-none motion-reduce:transition-none data-ending-style:opacity-0 data-[side=bottom]:data-ending-style:-translate-y-0.5 data-[side=bottom]:data-starting-style:-translate-y-0.5 data-[side=bottom]:data-starting-style:opacity-0 data-[side=left]:data-ending-style:translate-x-0.5 data-[side=left]:data-starting-style:translate-x-0.5 data-[side=left]:data-starting-style:opacity-0 data-[side=right]:data-ending-style:-translate-x-0.5 data-[side=right]:data-starting-style:-translate-x-0.5 data-[side=right]:data-starting-style:opacity-0 data-[side=top]:data-ending-style:translate-y-0.5 data-[side=top]:data-starting-style:translate-y-0.5 data-[side=top]:data-starting-style:opacity-0",
            shortcut && "flex items-center gap-2",
          )}
        >
          {content}
          {shortcut ? (
            <span className="text-subtle-foreground">
              <Keybinding binding={shortcut} />
            </span>
          ) : null}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export function AnchoredTooltip({ anchor, content, shortcut }: AnchoredTooltipProps) {
  if (!anchor) return null;

  return (
    <TooltipPrimitive.Root open disableHoverablePopup>
      <TooltipContent anchor={anchor} content={content} shortcut={shortcut} />
    </TooltipPrimitive.Root>
  );
}

export default function Tooltip({ content, children, shortcut, width }: TooltipProps) {
  return (
    <TooltipPrimitive.Root disableHoverablePopup>
      <TooltipPrimitive.Trigger
        render={
          <span
            className={cn(
              "inline-flex min-w-0 items-center",
              width === "full" && "w-full",
              width === "grow" && "flex-1",
            )}
          />
        }
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipContent content={content} shortcut={shortcut} />
    </TooltipPrimitive.Root>
  );
}
