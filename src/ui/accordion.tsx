import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";

import Badge from "@/ui/badge";
import { CaretDownIcon as CaretDown } from "@/ui/icons";
import { cn } from "@/utils/cn";

const accordionTriggerVariants = cva(
  "athas-chrome-control font-sans ui-text-caption group/accordion-trigger inline-flex h-(--athas-tab-height) w-fit max-w-full select-none items-center gap-(--athas-chrome-gap-tight) rounded-(--athas-chrome-radius) px-2 text-left font-normal text-subtle-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/50 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 aria-disabled:pointer-events-none aria-disabled:opacity-50",
);

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("min-w-0 space-y-1", className)}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  count,
  action,
  sticky = false,
  ...props
}: AccordionPrimitive.Trigger.Props & {
  count?: ReactNode;
  action?: ReactNode;
  sticky?: boolean;
}) {
  return (
    <AccordionPrimitive.Header
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-(--athas-chrome-gap-tight)",
        sticky && "sticky top-2 z-10 bg-background",
      )}
    >
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(accordionTriggerVariants(), className)}
        {...props}
      >
        <span className="min-w-0 truncate">{children}</span>
        <CaretDown
          data-slot="accordion-trigger-icon"
          className="pointer-events-none size-3 shrink-0 -rotate-90 text-subtle-foreground transition-transform group-aria-expanded/accordion-trigger:rotate-0"
        />
        {count !== undefined ? (
          <Badge variant="muted" size="compact" className="shrink-0">
            {count}
          </Badge>
        ) : null}
      </AccordionPrimitive.Trigger>
      {action ? <span className="flex shrink-0 items-center">{action}</span> : null}
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="overflow-hidden text-sm data-open:animate-accordion-down data-closed:animate-accordion-up"
      {...props}
    >
      <div
        className={cn(
          "flex h-(--accordion-panel-height) flex-col gap-1 pt-0 data-ending-style:h-0 data-starting-style:h-0",
          className,
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent, accordionTriggerVariants };
