import { useVirtualizer } from "@tanstack/react-virtual";
import type React from "react";
import { useMemo, useRef } from "react";
import { cn } from "@/utils/cn";

export interface TableViewProps {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  className?: string;
  dense?: boolean;
  actions?: React.ReactNode;
  stickyHeader?: boolean;
  virtualize?: boolean;
  rowHeight?: number;
  overscan?: number;
}

export function TableView({
  columns,
  rows,
  className,
  dense = true,
  actions,
  stickyHeader = true,
  virtualize = true,
  rowHeight = 28,
  overscan = 10,
}: TableViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const useVirtual = virtualize && rows.length > 200; // threshold to enable virtualization

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const gridTemplate = useMemo(
    () => `repeat(${columns.length}, minmax(120px, 1fr))`,
    [columns.length],
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
      {(actions || columns.length > 0) && (
        <div className="flex items-center justify-between border-border border-b bg-terniary-bg px-2 py-1.5">
          <div className="ui-font text-text-lighter text-xs">
            {rows.length} rows • {columns.length} columns
          </div>
          <div className="flex items-center gap-1">{actions}</div>
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {/* Header */}
        <div
          className={cn(
            "ui-font grid w-full gap-0 border-border border-b bg-secondary-bg text-xs",
            stickyHeader && "sticky top-0 isolate z-30",
          )}
          style={{ gridTemplateColumns: gridTemplate, willChange: "transform" }}
        >
          {columns.map((col, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-nowrap bg-secondary-bg px-2 py-1.5 text-left text-text",
                i > 0 && "border-border border-l",
              )}
            >
              {col}
            </div>
          ))}
        </div>

        {/* Body */}
        {useVirtual ? (
          <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const rIndex = virtualRow.index;
              const row = rows[rIndex];
              return (
                <div
                  key={virtualRow.key}
                  className="absolute right-0 left-0 grid w-full gap-0 hover:bg-hover"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    height: virtualRow.size,
                    gridTemplateColumns: gridTemplate,
                  }}
                >
                  {row.map((cell, cIndex) => (
                    <div
                      key={cIndex}
                      className={cn(
                        "max-w-[360px] border-border border-b px-2 text-xs",
                        cIndex > 0 && "border-border border-l",
                        dense ? "py-1" : "py-2",
                      )}
                      title={cell === null ? "NULL" : String(cell)}
                    >
                      {cell === null ? (
                        <span className="text-text-lighter italic">NULL</span>
                      ) : typeof cell === "object" ? (
                        <span className="block truncate text-accent">{JSON.stringify(cell)}</span>
                      ) : (
                        <span className="block truncate text-text">{String(cell)}</span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="ui-font">
            {rows.map((row, rIndex) => (
              <div
                key={rIndex}
                className="grid w-full gap-0 hover:bg-hover"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {row.map((cell, cIndex) => (
                  <div
                    key={cIndex}
                    className={cn(
                      "max-w-[360px] border-border border-b px-2 text-xs",
                      cIndex > 0 && "border-border border-l",
                      dense ? "py-1" : "py-2",
                    )}
                    title={cell === null ? "NULL" : String(cell)}
                  >
                    {cell === null ? (
                      <span className="text-text-lighter italic">NULL</span>
                    ) : typeof cell === "object" ? (
                      <span className="block truncate text-accent">{JSON.stringify(cell)}</span>
                    ) : (
                      <span className="block truncate text-text">{String(cell)}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
