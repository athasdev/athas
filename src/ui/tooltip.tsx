import { Tooltip as TooltipPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import type React from "react";
import Keybinding from "@/features/keymaps/components/keybinding";
import { cn } from "@/utils/cn";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  shortcut?: string;
  triggerClassName?: string;
}

interface AnchoredTooltipProps extends Omit<TooltipProps, "children" | "triggerClassName"> {
  anchor: Element | null;
}

const tooltipContentVariants = cva(
  "ui-text-chrome pointer-events-none z-99999 whitespace-nowrap rounded-lg border border-border/50 bg-surface/90 px-2.5 py-1.5 text-subtle-foreground shadow-(--shadow-card) backdrop-blur-md transition-[opacity,transform] duration-fast ease-smooth data-ending-style:opacity-0 data-[side=bottom]:data-ending-style:-translate-y-0.5 data-[side=bottom]:data-starting-style:-translate-y-0.5 data-[side=bottom]:data-starting-style:opacity-0 data-[side=left]:data-ending-style:translate-x-0.5 data-[side=left]:data-starting-style:translate-x-0.5 data-[side=left]:data-starting-style:opacity-0 data-[side=right]:data-ending-style:-translate-x-0.5 data-[side=right]:data-starting-style:-translate-x-0.5 data-[side=right]:data-starting-style:opacity-0 data-[side=top]:data-ending-style:translate-y-0.5 data-[side=top]:data-starting-style:translate-y-0.5 data-[side=top]:data-starting-style:opacity-0",
);

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
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        anchor={anchor}
        side="top"
        sideOffset={4}
        collisionPadding={8}
        positionMethod={anchor ? "fixed" : undefined}
        className="z-99999"
      >
        <TooltipPrimitive.Popup
          className={cn(tooltipContentVariants(), shortcut && "flex items-center gap-2")}
        >
          {content}
          {shortcut ? (
            <span className="opacity-70">
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

export default function Tooltip({ content, children, shortcut, triggerClassName }: TooltipProps) {
  return (
    <TooltipPrimitive.Root disableHoverablePopup>
      <TooltipPrimitive.Trigger
        render={<span className={cn("inline-flex items-center", triggerClassName)} />}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipContent content={content} shortcut={shortcut} />
    </TooltipPrimitive.Root>
  );
}
