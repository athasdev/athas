import "@/features/sidebar/styles/sidebar-tree.css";
import { ChevronDownIcon as ChevronDown, ChevronRightIcon as ChevronRight } from "@/ui/icons";
import type React from "react";
import { forwardRef, useCallback } from "react";
import { cn } from "@/utils/cn";

const SIDEBAR_TREE_BASE_INDENT = 10;
const SIDEBAR_TREE_INDENT_SIZE = 14;

interface SidebarTreeGuidesProps {
  depth: number;
  baseIndent?: number;
  indentSize?: number;
  previousDepth?: number;
  nextDepth?: number;
}

function SidebarTreeGuides({
  depth,
  baseIndent = SIDEBAR_TREE_BASE_INDENT,
  indentSize = SIDEBAR_TREE_INDENT_SIZE,
  previousDepth = depth,
  nextDepth = depth,
}: SidebarTreeGuidesProps) {
  if (depth <= 0) return null;

  return (
    <div className="file-tree-guides">
      {Array.from({ length: depth }, (_, level) => {
        const startsHere = previousDepth <= level;
        const endsHere = nextDepth <= level;

        return (
          <span
            key={level}
            className="file-tree-guide"
            style={{
              left: `calc(${baseIndent + level * indentSize}px + var(--file-tree-guide-icon-offset, 7px))`,
              top: startsHere ? "4px" : "0",
              bottom: endsHere ? "4px" : "0",
            }}
          />
        );
      })}
    </div>
  );
}

interface SidebarTreeProps extends React.ComponentPropsWithoutRef<"div"> {
  label: string;
}

function getTreeItems(tree: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    tree.querySelectorAll<HTMLButtonElement>("[role=treeitem]:not(:disabled)"),
  ).filter((item) => item.offsetParent !== null);
}

function getTreeItemDepth(item: HTMLElement): number {
  return Number(item.dataset.depth ?? 0);
}

export const SidebarTree = forwardRef<HTMLDivElement, SidebarTreeProps>(function SidebarTree(
  { label, className, onFocus, onKeyDown, ...props },
  ref,
) {
  const handleFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      onFocus?.(event);
      if (event.defaultPrevented || event.target !== event.currentTarget) return;

      const items = getTreeItems(event.currentTarget);
      const selectedItem = items.find((item) => item.getAttribute("aria-selected") === "true");
      (selectedItem ?? items[0])?.focus();
    },
    [onFocus],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;

      const currentItem = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        "[role=treeitem]",
      );
      if (!currentItem || !event.currentTarget.contains(currentItem)) return;

      const items = getTreeItems(event.currentTarget);
      const currentIndex = items.indexOf(currentItem);
      if (currentIndex < 0) return;

      const focusItem = (item: HTMLButtonElement | undefined) => {
        if (!item) return;
        event.preventDefault();
        item.focus();
      };
      const disclosure = currentItem.querySelector<HTMLElement>("[data-sidebar-tree-disclosure]");
      const expanded = currentItem.getAttribute("aria-expanded");
      const currentDepth = getTreeItemDepth(currentItem);

      switch (event.key) {
        case "ArrowDown":
          focusItem(items[currentIndex + 1]);
          break;
        case "ArrowUp":
          focusItem(items[currentIndex - 1]);
          break;
        case "Home":
          focusItem(items[0]);
          break;
        case "End":
          focusItem(items[items.length - 1]);
          break;
        case "ArrowRight":
          if (expanded === "false" && disclosure) {
            event.preventDefault();
            disclosure.click();
            break;
          }
          if (expanded === "true") {
            const child = items
              .slice(currentIndex + 1)
              .find((item) => getTreeItemDepth(item) === currentDepth + 1);
            focusItem(child);
          }
          break;
        case "ArrowLeft":
          if (expanded === "true" && disclosure) {
            event.preventDefault();
            disclosure.click();
            break;
          }
          for (let index = currentIndex - 1; index >= 0; index -= 1) {
            const candidate = items[index];
            if (candidate && getTreeItemDepth(candidate) < currentDepth) {
              focusItem(candidate);
              break;
            }
          }
          break;
      }
    },
    [onKeyDown],
  );

  return (
    <div
      ref={ref}
      role="tree"
      aria-label={label}
      tabIndex={0}
      className={cn("outline-none", className)}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
});

type SidebarTreeRowProps = Omit<React.ComponentPropsWithoutRef<"button">, "children"> & {
  active?: boolean;
  depth?: number;
  indentSize?: number;
  baseIndent?: number;
  previousDepth?: number;
  nextDepth?: number;
  containerClassName?: string;
  expanded?: boolean;
  label?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  action?: React.ReactNode;
  guides?: React.ReactNode;
  description?: React.ReactNode;
  onToggle?: (event: React.MouseEvent<HTMLSpanElement>) => void;
  reserveDisclosureSpace?: boolean;
  showDisclosure?: boolean;
  showGuides?: boolean;
  children?: React.ReactNode;
};

export const SidebarTreeRow = forwardRef<HTMLButtonElement, SidebarTreeRowProps>(
  function SidebarTreeRow(
    {
      active = false,
      depth = 0,
      indentSize = SIDEBAR_TREE_INDENT_SIZE,
      baseIndent = SIDEBAR_TREE_BASE_INDENT,
      previousDepth = depth,
      nextDepth = depth,
      containerClassName,
      expanded,
      label,
      leading,
      trailing,
      action,
      guides,
      description,
      onToggle,
      reserveDisclosureSpace = false,
      showDisclosure = expanded !== undefined,
      showGuides = true,
      className,
      children,
      style,
      tabIndex = -1,
      ...props
    },
    ref,
  ) {
    return (
      <div
        className={cn("file-tree-item flex w-full min-w-0 items-center", containerClassName)}
        data-sidebar-tree-row=""
        data-active={active ? "true" : undefined}
        data-depth={depth}
      >
        {guides !== undefined ? (
          guides
        ) : showGuides ? (
          <SidebarTreeGuides
            depth={depth}
            baseIndent={baseIndent}
            indentSize={indentSize}
            previousDepth={previousDepth}
            nextDepth={nextDepth}
          />
        ) : null}
        <button
          ref={ref}
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={active}
          aria-expanded={expanded}
          data-depth={depth}
          tabIndex={tabIndex}
          className={cn(
            "file-tree-row font-sans ui-text-sm flex w-full min-w-0 flex-1 select-none items-center whitespace-nowrap rounded-lg border border-transparent bg-transparent text-left text-foreground outline-none transition-colors duration-(--app-duration-fast) ease-(--app-ease-smooth) hover:bg-accent focus-visible:border-primary/40 gap-1.5 px-1.5 py-1 leading-row",
            active && "bg-selected",
            action && "pr-0",
            className,
          )}
          style={{ paddingLeft: `${baseIndent + depth * indentSize}px`, ...style }}
          {...props}
        >
          {showDisclosure || reserveDisclosureSpace ? (
            <SidebarTreeDisclosure
              visible={showDisclosure}
              expanded={expanded}
              onClick={onToggle}
            />
          ) : null}
          {leading ? <SidebarTreeIcon icon={leading} /> : null}
          {label !== undefined ? (
            <span className="relative z-1 flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
              <span className="min-w-0 truncate">{label}</span>
              {description ? (
                <span className="min-w-0 flex-1 truncate text-subtle-foreground/80">
                  {description}
                </span>
              ) : null}
            </span>
          ) : (
            children
          )}
          {trailing ? (
            <span className="relative z-1 ml-auto flex min-w-0 shrink items-center overflow-hidden">
              {trailing}
            </span>
          ) : null}
        </button>
        {action ? (
          <span className="relative z-3 flex shrink-0 items-center px-2">{action}</span>
        ) : null}
      </div>
    );
  },
);

interface SidebarTreeDisclosureProps {
  expanded?: boolean;
  visible?: boolean;
  onClick?: (event: React.MouseEvent<HTMLSpanElement>) => void;
  className?: string;
}

export function SidebarTreeDisclosure({
  expanded = false,
  visible = true,
  onClick,
  className,
}: SidebarTreeDisclosureProps) {
  return (
    <span
      data-sidebar-tree-disclosure=""
      aria-hidden="true"
      className={cn(
        "mr-0.5 flex size-4 shrink-0 items-center justify-center rounded text-subtle-foreground transition-colors",
        visible ? "hover:text-foreground" : "pointer-events-none text-transparent",
        className,
      )}
      onClick={(event) => {
        if (!onClick) return;
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
      }}
    >
      {visible ? (
        expanded ? (
          <ChevronDown className="size-3" weight="bold" />
        ) : (
          <ChevronRight className="size-3" weight="bold" />
        )
      ) : (
        <span className="size-3" />
      )}
    </span>
  );
}

interface SidebarTreeIconProps {
  icon: React.ReactNode;
  className?: string;
}

export function SidebarTreeIcon({ icon, className }: SidebarTreeIconProps) {
  return (
    <span className={cn("relative z-1 shrink-0 text-subtle-foreground", className)}>{icon}</span>
  );
}
