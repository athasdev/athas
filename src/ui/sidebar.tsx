import { type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { animate, motion, useMotionValue } from "framer-motion";
import {
  forwardRef,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
  useRef,
} from "react";
import { Button, type ButtonProps } from "@/ui/button";
import Input from "@/ui/input";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export function SidebarPanel({
  children,
  className,
  framed = false,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  framed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col bg-primary-bg",
        framed && "rounded-lg border border-border/70",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export const SidebarFooter = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & {
    children: ReactNode;
    surface?: boolean;
    attached?: boolean;
  }
>(function SidebarFooter(
  { children, className, surface = false, attached = false, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "shrink-0 bg-primary-bg/95 px-2 py-2",
        surface &&
          cn(
            "mx-2 mb-2 border border-border/70 bg-[color-mix(in_srgb,var(--color-secondary-bg)_82%,var(--color-border)_18%)] px-0 py-0 pb-1 transition-[border-radius,background-color,border-color,box-shadow]",
            attached ? "rounded-t-xl rounded-b-2xl" : "rounded-2xl",
          ),
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

export function SidebarHeader({
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 flex h-8 shrink-0 select-none items-center gap-1.5 bg-primary-bg/95 px-1.5 py-1 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarComposer({
  children,
  className,
  attached = false,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  attached?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden border border-border/70 bg-[color-mix(in_srgb,var(--color-secondary-bg)_82%,var(--color-border)_18%)] pb-1 transition-[border-radius,background-color,border-color,box-shadow]",
        attached ? "rounded-t-xl rounded-b-2xl" : "rounded-2xl",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarComposerBody({
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--color-primary-bg)_96%,var(--color-secondary-bg)_4%)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export const SidebarHeaderSearch = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<typeof Input>, "onChange" | "value" | "size" | "variant"> & {
    value: string;
    onChange: (value: string) => void;
    leftIcon: PhosphorIcon;
  }
>(function SidebarHeaderSearch(
  { value, onChange, leftIcon, placeholder = "Search", className, containerClassName, ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      leftIcon={leftIcon}
      variant="ghost"
      size="xs"
      placeholder={placeholder}
      className={cn("h-6 rounded-md border-transparent bg-transparent select-text", className)}
      containerClassName={cn("min-w-0 flex-1", containerClassName)}
      {...props}
    />
  );
});

export const SidebarHeaderIconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "variant" | "compact">
>(function SidebarHeaderIconButton({ className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      compact
      className={cn("size-6 rounded-md p-0", className)}
      {...props}
    />
  );
});

export function SidebarListItem({
  children,
  active = false,
  leading,
  trailing,
  className,
  contentClassName,
  ...props
}: ComponentProps<"button"> & {
  children: ReactNode;
  active?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  contentClassName?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "ui-font flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-text-lighter transition-[background-color,color]",
        "hover:bg-hover/70 hover:text-text focus-visible:bg-hover/70 focus-visible:text-text focus-visible:outline-none",
        active && "bg-hover/80 text-text",
        className,
      )}
      {...props}
    >
      {leading ? (
        <span className="flex shrink-0 items-center justify-center">{leading}</span>
      ) : null}
      <span className={cn("min-w-0 flex-1", contentClassName)}>{children}</span>
      {trailing ? <span className="shrink-0 text-text-lighter">{trailing}</span> : null}
    </button>
  );
}

export interface SidebarSectionSwitcherItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SidebarSectionPagerItem {
  id: string;
  content: ReactNode;
  disabled?: boolean;
}

const SIDEBAR_SECTION_PAGER_SPRING = {
  type: "spring" as const,
  stiffness: 360,
  damping: 36,
  mass: 0.8,
};

export function SidebarSectionPager({
  items,
  value,
  className,
}: {
  items: SidebarSectionPagerItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const animationStopRef = useRef<(() => void) | null>(null);
  const x = useMotionValue(0);
  const [pagerWidth, setPagerWidth] = useState(0);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );
  const activeX = pagerWidth > 0 ? -activeIndex * pagerWidth : 0;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateWidth = () => setPagerWidth(viewport.clientWidth);
    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (pagerWidth <= 0) return;

    animationStopRef.current?.();
    const controls = animate(x, activeX, SIDEBAR_SECTION_PAGER_SPRING);
    animationStopRef.current = () => controls.stop();
    return () => controls.stop();
  }, [activeX, pagerWidth, x]);

  useEffect(() => {
    return () => {
      animationStopRef.current?.();
    };
  }, []);

  return (
    <div ref={viewportRef} className={cn("min-h-0 overflow-hidden", className)}>
      <motion.div className="flex h-full min-h-0" style={{ x }}>
        {items.map((item) => {
          const isActive = item.id === value;

          return (
            <div
              key={item.id}
              aria-hidden={!isActive}
              className={cn(
                "h-full min-w-full cursor-auto overflow-hidden",
                !isActive && "pointer-events-none",
              )}
            >
              {item.content}
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

export function SidebarSectionSwitcher({
  items,
  value,
  onChange,
  className,
  itemClassName,
}: {
  items: SidebarSectionSwitcherItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "mx-auto flex h-7 w-fit max-w-full shrink-0 select-none items-center justify-center gap-1 rounded-full bg-secondary-bg/45 p-0.5",
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.id === value;
        const button = (
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={item.label}
            disabled={item.disabled}
            className={cn(
              "ui-font flex h-6 min-w-0 items-center justify-center gap-1.5 rounded-full text-[11px] outline-none transition-[background-color,color,width,padding]",
              selected
                ? "max-w-28 bg-hover px-2 text-text"
                : "w-7 px-0 text-text-lighter hover:bg-hover/70 hover:text-text",
              item.disabled && "cursor-not-allowed opacity-50",
              itemClassName,
            )}
            onClick={() => onChange(item.id)}
          >
            {item.icon ? (
              <span className="flex size-4 shrink-0 items-center justify-center">{item.icon}</span>
            ) : null}
            {selected ? (
              <span className="min-w-0 truncate whitespace-nowrap">{item.label}</span>
            ) : null}
          </button>
        );

        return (
          <Tooltip key={item.id} content={item.label} side="bottom">
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}

export function SidebarEmptyState({
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "ui-font ui-text-sm flex min-h-24 select-none items-center justify-center px-3 py-6 text-center text-text-lighter",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarEmptyActionState({
  icon,
  message,
  description,
  actionLabel,
  onAction,
  actionDisabled = false,
  className,
  actionClassName,
  tone = "neutral",
  children,
  ...props
}: ComponentProps<"div"> & {
  icon?: ReactNode;
  message: ReactNode;
  description?: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  actionDisabled?: boolean;
  actionClassName?: string;
  tone?: "neutral" | "error" | "success";
}) {
  return (
    <div
      className={cn(
        "ui-font flex min-h-24 select-none flex-col items-center justify-center gap-1.5 px-3 py-6 text-center text-text-lighter",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          className={cn(
            "mb-0.5 flex size-7 items-center justify-center text-text-lighter",
            tone === "error" && "text-error",
            tone === "success" && "text-success",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div
        className={cn(
          "ui-text-sm leading-[1.35]",
          tone === "error" && "text-error",
          tone === "success" && "text-success",
        )}
      >
        {message}
      </div>
      {description ? (
        <div className="max-w-[24ch] text-xs leading-[1.35] text-text-lighter">{description}</div>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="ghost"
          compact
          className={cn("h-6 px-2 text-text-lighter text-xs hover:text-text", actionClassName)}
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
      {children}
    </div>
  );
}
