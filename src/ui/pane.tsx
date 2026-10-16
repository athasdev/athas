import { cva, type VariantProps } from "class-variance-authority";
import {
  type ComponentProps,
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChromeGroup } from "@/ui/chrome";
import { ControlSizeProvider } from "@/ui/control-size";
import { cn } from "@/utils/cn";

/**
 * The one pane chrome of the workbench: editor groups, agent sessions, dock tools and the bottom
 * pane all open with the same header row. A pane is a `group/chrome-host`, so the secondary
 * actions in its header stay ghosted until the pointer is over the pane or focus is inside it.
 */
const paneVariants = cva(
  "group/chrome-host flex min-h-0 min-w-0 flex-col overflow-hidden font-sans",
  {
    variants: {
      /**
       * - `island` — a raised card on the page plane, as the editor area and each dock tool
       * - `plain` — no surface of its own, inside something that already has one
       */
      surface: {
        island: "athas-glass-island rounded-xl bg-background shadow-(--shadow-raised)",
        plain: "",
      },
    },
    defaultVariants: { surface: "plain" },
  },
);

const PaneHeaderSlotContext = createContext<{
  target: HTMLElement | null;
  setTarget: (element: HTMLElement | null) => void;
} | null>(null);

export const Pane = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> &
    VariantProps<typeof paneVariants> & {
      /**
       * Lets the view inside hand its own title bar actions to this pane's header (see
       * `PaneHeaderPortal`), so a view hosted in a pane does not stack a second header under it.
       */
      hostsViewChrome?: boolean;
    }
>(function Pane({ className, surface, hostsViewChrome = false, children, ...props }, ref) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const content = (
    <div ref={ref} data-slot="pane" className={cn(paneVariants({ surface }), className)} {...props}>
      {children}
    </div>
  );
  return hostsViewChrome ? (
    <PaneHeaderSlotContext.Provider value={{ target, setTarget }}>
      {content}
    </PaneHeaderSlotContext.Provider>
  ) : (
    content
  );
});

const paneHeaderVariants = cva(
  "flex h-pane-header min-h-pane-header w-full min-w-0 shrink-0 select-none items-center gap-chrome px-2 font-sans ui-text-chrome text-subtle-foreground",
  {
    variants: {
      /** A hairline under the header, for a header over content of the same tone. */
      separated: { true: "border-divider border-b", false: "" },
      /** Another pane is dragged over this header, to be dropped in its place. */
      dropTarget: { true: "bg-accent", false: "" },
    },
    defaultVariants: { separated: false, dropTarget: false },
  },
);

/** The header row of a pane: its title or tabs on the left, then its actions. */
export const PaneHeader = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & VariantProps<typeof paneHeaderVariants>
>(function PaneHeader({ className, separated, dropTarget, ...props }, ref) {
  return (
    <ControlSizeProvider size="sm">
      <div
        ref={ref}
        data-slot="pane-header"
        className={cn(paneHeaderVariants({ separated, dropTarget }), className)}
        {...props}
      />
    </ControlSizeProvider>
  );
});

/** A pane's icon and name, with an optional quiet reading such as a count after it. */
export function PaneTitle({
  icon,
  detail,
  children,
  className,
  ...props
}: ComponentProps<"div"> & { icon?: ReactNode; detail?: ReactNode }) {
  return (
    <div
      data-slot="pane-title"
      className={cn("flex min-w-0 flex-1 items-center gap-chrome-loose px-1", className)}
      {...props}
    >
      {icon ? (
        <span className="flex shrink-0 items-center text-subtle-foreground [&_svg]:size-[1em]">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate font-medium text-foreground">{children}</span>
      {detail ? (
        <span className="shrink-0 tabular-nums text-subtle-foreground">{detail}</span>
      ) : null}
    </div>
  );
}

/**
 * The actions at the end of a pane header. Secondary ones stay ghosted until the pane is hovered
 * or focused and keep their hit areas; pass `reveal={false}` for actions that must always show.
 * Put maximize and close last.
 */
export function PaneActions({
  className,
  reveal = true,
  children,
  ...props
}: Omit<ComponentProps<typeof ChromeGroup>, "gap" | "grow"> & { reveal?: boolean }) {
  const slot = useContext(PaneHeaderSlotContext);
  return (
    <ChromeGroup
      data-slot="pane-actions"
      gap="tight"
      reveal={reveal}
      className={cn("ml-auto", className)}
      {...props}
    >
      {slot ? <span ref={slot.setTarget} className="contents" /> : null}
      {children}
    </ChromeGroup>
  );
}

/** Whether a hosting pane takes this view's title bar actions into its own header. */
export function usePaneHeaderHost(): boolean {
  return useContext(PaneHeaderSlotContext) !== null;
}

/** Renders a hosted view's header actions in the header of the pane that hosts it. */
export function PaneHeaderPortal({ children }: { children: ReactNode }) {
  const slot = useContext(PaneHeaderSlotContext);
  if (!slot?.target) return null;
  return createPortal(children, slot.target);
}

export function PaneBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="pane-body"
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}
      {...props}
    />
  );
}

export { paneHeaderVariants };
