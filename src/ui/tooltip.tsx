import { Tooltip as TooltipPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import type React from "react";
import Keybinding from "@/ui/keybinding";
import { cn } from "@/utils/cn";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  shortcut?: string;
  className?: string;
  triggerClassName?: string;
}

const tooltipContentVariants = cva(
  "ui-text-sm pointer-events-none z-[99999] whitespace-nowrap rounded-[var(--app-radius-menu-item)] border border-border/70 bg-secondary-bg/95 px-2.5 py-1.5 text-text shadow-[var(--shadow-popover)] backdrop-blur-sm transition-[opacity,transform,filter] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] [filter:blur(0)] data-[ending-style]:opacity-0 data-[ending-style]:[filter:blur(2px)] data-[side=bottom]:data-[ending-style]:-translate-y-1 data-[side=bottom]:data-[starting-style]:-translate-y-1 data-[side=bottom]:data-[starting-style]:opacity-0 data-[side=bottom]:data-[starting-style]:[filter:blur(2px)] data-[side=left]:data-[ending-style]:translate-x-1 data-[side=left]:data-[starting-style]:translate-x-1 data-[side=left]:data-[starting-style]:opacity-0 data-[side=left]:data-[starting-style]:[filter:blur(2px)] data-[side=right]:data-[ending-style]:-translate-x-1 data-[side=right]:data-[starting-style]:-translate-x-1 data-[side=right]:data-[starting-style]:opacity-0 data-[side=right]:data-[starting-style]:[filter:blur(2px)] data-[side=top]:data-[ending-style]:translate-y-1 data-[side=top]:data-[starting-style]:translate-y-1 data-[side=top]:data-[starting-style]:opacity-0 data-[side=top]:data-[starting-style]:[filter:blur(2px)]",
);

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delay={150} timeout={100} closeDelay={0}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export default function Tooltip({
  content,
  children,
  side = "top",
  shortcut,
  className,
  triggerClassName,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root disableHoverablePopup>
      <TooltipPrimitive.Trigger
        render={<span className={cn("inline-flex items-center", triggerClassName)} />}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[99999]"
        >
          <TooltipPrimitive.Popup
            className={cn(
              tooltipContentVariants(),
              shortcut && "flex items-center gap-2",
              className,
            )}
          >
            {content}
            {shortcut && <Keybinding binding={shortcut} />}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
