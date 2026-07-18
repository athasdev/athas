import "@/features/sidebar/styles/sidebar-tree.css";
import { ChevronDownIcon as ChevronDown, ChevronRightIcon as ChevronRight } from "@/ui/icons";
import type React from "react";
import { forwardRef } from "react";
import { cn } from "@/utils/cn";
import { TreeRow } from "./tree-row";

export const SIDEBAR_TREE_BASE_INDENT = 10;
export const SIDEBAR_TREE_INDENT_SIZE = 14;
export const SIDEBAR_TREE_ICON_SIZE = 14;

interface SidebarTreeGuidesProps {
  depth: number;
  baseIndent?: number;
  indentSize?: number;
  previousDepth?: number;
  nextDepth?: number;
}

export function SidebarTreeGuides({
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

type SidebarTreeRowProps = React.ComponentPropsWithoutRef<"button"> & {
  active?: boolean;
  depth?: number;
  indentSize?: number;
  baseIndent?: number;
  previousDepth?: number;
  nextDepth?: number;
  containerClassName?: string;
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
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <div
        className={cn("file-tree-item w-full", containerClassName)}
        data-active={active ? "true" : undefined}
        data-depth={depth}
      >
        <SidebarTreeGuides
          depth={depth}
          baseIndent={baseIndent}
          indentSize={indentSize}
          previousDepth={previousDepth}
          nextDepth={nextDepth}
        />
        <TreeRow
          ref={ref}
          active={false}
          depth={depth}
          indentSize={indentSize}
          baseIndent={baseIndent}
          className={cn("gap-1.5 border border-transparent px-1.5 py-1 leading-[1.35]", className)}
          {...props}
        >
          {children}
        </TreeRow>
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
      className={cn(
        "mr-0.5 flex size-4 shrink-0 items-center justify-center rounded text-text-lighter transition-colors",
        visible ? "hover:text-text" : "pointer-events-none text-transparent",
        className,
      )}
      onClick={onClick}
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
  return <span className={cn("relative z-1 shrink-0 text-text-lighter", className)}>{icon}</span>;
}
