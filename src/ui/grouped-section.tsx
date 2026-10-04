import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { Card } from "@/ui/card";
import { cn } from "@/utils/cn";

const groupedSectionTitleVariants = cva(
  "flex min-w-0 items-center gap-1.5 font-medium [&_svg]:size-[1em] [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        default: "",
        /** A destructive zone, such as resetting or deleting data. */
        danger: "text-destructive",
      },
      /** `label` is a small muted caption over a card; `heading` titles rows on the page itself. */
      size: {
        label: "ui-text-sm",
        heading: "ui-text-base",
      },
    },
    compoundVariants: [
      { tone: "default", size: "label", className: "text-muted-foreground" },
      { tone: "default", size: "heading", className: "text-foreground" },
    ],
    defaultVariants: { tone: "default", size: "label" },
  },
);

/** Hairlines between flat rows, inset like the grouped card's, without the card. */
const FLAT_ROW_DIVIDERS =
  "*:relative *:not-first:before:pointer-events-none *:not-first:before:absolute *:not-first:before:inset-x-3 *:not-first:before:top-0 *:not-first:before:h-px *:not-first:before:bg-border";

export interface GroupedSectionProps
  extends
    Omit<ComponentProps<"section">, "title">,
    Pick<VariantProps<typeof groupedSectionTitleVariants>, "tone"> {
  title: ReactNode;
  /** A small mark before the title, such as a provider logo. */
  icon?: ReactNode;
  /** One short line, only when the title cannot say it alone. */
  description?: ReactNode;
  /** Section-level actions, aligned with the title. */
  actions?: ReactNode;
  /**
   * - `group` — rows inside one grouped card on the `background` plane, split by inset hairlines
   * - `flat` — rows directly on the current plane under a heading, split by hairlines, no card
   * - `bare` — content that brings its own layout, such as a table or a grid of cards
   */
  variant?: "group" | "flat" | "bare";
}

/**
 * A small muted title over one grouped card of rows, as in Settings and the Integrations
 * catalog. The card owns the edge and the hairlines; rows own only their padding. Set
 * `data-highlighted="true"` on the section to ring the card, e.g. for a search result.
 */
export function GroupedSection({
  title,
  icon,
  description,
  actions,
  variant = "group",
  tone,
  className,
  children,
  ...props
}: GroupedSectionProps) {
  return (
    <section
      data-slot="grouped-section"
      className={cn("group/grouped-section flex min-w-0 flex-col gap-1.5", className)}
      {...props}
    >
      <header className="flex min-h-6 min-w-0 items-center gap-2 px-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2
            className={groupedSectionTitleVariants({
              tone,
              size: variant === "flat" ? "heading" : "label",
            })}
          >
            {icon}
            <span className="truncate">{title}</span>
          </h2>
          {description ? <p className="text-subtle-foreground ui-text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      {variant === "group" ? (
        <Card
          layout="list"
          plane="background"
          className="transition-shadow group-data-[highlighted=true]/grouped-section:ring-1 group-data-[highlighted=true]/grouped-section:ring-focus"
        >
          {children}
        </Card>
      ) : variant === "flat" ? (
        <div className={cn("flex min-w-0 flex-col", FLAT_ROW_DIVIDERS)}>{children}</div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">{children}</div>
      )}
    </section>
  );
}
