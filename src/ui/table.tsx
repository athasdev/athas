import type React from "react";
import { cn } from "@/utils/cn";

interface TableProps {
  children: React.ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
}

interface TableHeaderProps {
  children: React.ReactNode;
  gridCols: string;
  className?: string;
}

export function TableHeader({ children, gridCols, className }: TableHeaderProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 grid gap-4 border-border border-b bg-primary-bg px-2 py-2",
        className,
      )}
      style={{ gridTemplateColumns: gridCols }}
    >
      {children}
    </div>
  );
}

interface TableRowProps {
  children: React.ReactNode;
  gridCols: string;
  className?: string;
  onClick?: () => void;
}

export function TableRow({ children, gridCols, className, onClick }: TableRowProps) {
  return (
    <div
      className={cn(
        "grid gap-4 border-border border-b px-2 py-2",
        onClick && "cursor-pointer hover:bg-hover",
        className,
      )}
      style={{ gridTemplateColumns: gridCols }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

interface TableCellProps {
  children: React.ReactNode;
  className?: string;
}

export function TableCell({ children, className }: TableCellProps) {
  return <div className={cn("flex items-center", className)}>{children}</div>;
}

interface TableHeadCellProps {
  children: React.ReactNode;
  className?: string;
}

export function TableHeadCell({ children, className }: TableHeadCellProps) {
  return <div className={cn("font-medium text-text-lighter text-xs", className)}>{children}</div>;
}
