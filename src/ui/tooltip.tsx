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
  "ui-text-sm pointer-events-none z-[99999] whitespace-nowrap rounded-lg border border-border/70 bg-secondary-bg/95 px-2.5 py-1.5 text-text shadow-lg backdrop-blur-sm animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
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
        <TooltipPrimitive.Positioner side={side} sideOffset={6} collisionPadding={8}>
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
