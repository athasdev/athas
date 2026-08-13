import { Tooltip as TooltipPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import type React from "react";
import Keybinding from "@/features/keymaps/components/keybinding";
import { cn } from "@/utils/cn";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  shortcut?: string;
  triggerClassName?: string;
}

const tooltipContentVariants = cva(
  "ui-text-chrome pointer-events-none z-99999 whitespace-nowrap rounded-(--athas-chrome-radius) border border-border/60 bg-surface/95 px-2 py-1 text-foreground shadow-(--shadow-card) backdrop-blur-sm transition-[opacity,transform] duration-(--app-duration-fast) ease-(--app-ease-smooth) data-ending-style:opacity-0 data-[side=bottom]:data-ending-style:-translate-y-0.5 data-[side=bottom]:data-starting-style:-translate-y-0.5 data-[side=bottom]:data-starting-style:opacity-0 data-[side=left]:data-ending-style:translate-x-0.5 data-[side=left]:data-starting-style:translate-x-0.5 data-[side=left]:data-starting-style:opacity-0 data-[side=right]:data-ending-style:-translate-x-0.5 data-[side=right]:data-starting-style:-translate-x-0.5 data-[side=right]:data-starting-style:opacity-0 data-[side=top]:data-ending-style:translate-y-0.5 data-[side=top]:data-starting-style:translate-y-0.5 data-[side=top]:data-starting-style:opacity-0",
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
          sideOffset={4}
          collisionPadding={8}
          className="z-99999"
        >
          <TooltipPrimitive.Popup
            className={cn(tooltipContentVariants(), shortcut && "flex items-center gap-2")}
          >
            {content}
            {shortcut && <Keybinding binding={shortcut} />}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
