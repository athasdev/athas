import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * A text entry surface with its own chips, notices and toolbar inside one rounded plane.
 * The ring follows keyboard focus inside it, so clicking a toolbar menu does not light it up.
 */
export const Composer = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & { dragActive?: boolean }
>(function Composer({ className, dragActive = false, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="composer"
      data-drag-active={dragActive || undefined}
      className={cn(
        "relative flex min-w-0 shrink-0 flex-col rounded-xl bg-field text-foreground shadow-(--shadow-raised) transition-shadow duration-fast ease-smooth motion-reduce:transition-none has-focus-visible:ring-2 has-focus-visible:ring-focus data-[drag-active=true]:ring-2 data-[drag-active=true]:ring-focus",
        className,
      )}
      {...props}
    />
  );
});

const composerEditableVariants = cva(
  "w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap wrap-break-word bg-transparent px-3 pt-3 pb-1.5 text-left ui-text-base leading-relaxed text-foreground outline-none empty:before:pointer-events-none empty:before:text-subtle-foreground empty:before:content-[attr(data-placeholder)]",
  {
    variants: {
      font: { sans: "font-sans", mono: "font-mono" },
      /** `roomy` is the first prompt of an empty chat, where the composer is the whole page. */
      size: { default: "max-h-48 min-h-11", roomy: "max-h-64 min-h-20" },
      enabled: { true: "cursor-text", false: "cursor-not-allowed text-muted-foreground" },
      /** One line that grows with the text, sharing a row with the composer's buttons. */
      inline: { true: "min-h-8 px-1.5 py-1.5", false: "" },
    },
    defaultVariants: { font: "sans", size: "default", enabled: true, inline: false },
  },
);

export const ComposerEditable = forwardRef<
  HTMLDivElement,
  Omit<ComponentProps<"div">, "enabled"> & VariantProps<typeof composerEditableVariants>
>(function ComposerEditable({ className, enabled = true, font, size, inline, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="composer-editable"
      aria-disabled={!enabled || undefined}
      className={cn(composerEditableVariants({ font, size, enabled, inline }), className)}
      {...props}
    />
  );
});

/** The input row of an inline composer: its leading button, the text, then its trailing buttons. */
export function ComposerRow({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-row"
      className={cn("flex min-w-0 items-end gap-1 p-1.5", className)}
      {...props}
    />
  );
}

/** The row of controls along the bottom edge inside the composer. */
export function ComposerToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-toolbar"
      className={cn("flex min-w-0 items-center gap-1 px-1.5 pb-1.5", className)}
      {...props}
    />
  );
}

/** Covers the composer while something droppable is dragged over it. */
export function ComposerDropHint({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="composer-drop-hint"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] bg-surface"
    >
      <div className="flex size-full items-center justify-center gap-1.5 rounded-[inherit] bg-primary-soft font-sans ui-text-sm font-medium text-primary">
        {children}
      </div>
    </div>
  );
}
