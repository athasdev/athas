// TODO: refactor src/ui/virtualized-list.tsx to here

import { useVirtualizer } from "@tanstack/react-virtual";
import React from "react";

export function VirtualizedList({ className = "" }: { className?: string }): React.ReactNode {
  // Scrollable element for the list
  const parentRef = React.useRef(null);

  // TODO: allow outside access to virtualizer settings (from storybook)
  const lineVirtualizer = useVirtualizer({
    count: 10000, // number of elements to virtualize
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36, // height in px
  });

  return (
    <>
      {/* Scrollable element for the list */}
      <div ref={parentRef} style={{ height: "100%", overflow: "auto" }} className={className}>
        {/* The large inner element to hold all the items */}
        <div className="relative w-full" style={{ height: `${lineVirtualizer.getTotalSize()}px` }}>
          {/* Only the visible items in the virtualizer, manually positioned to be in view */}
          {lineVirtualizer.getVirtualItems().map((virtualItem) => (
            <div
              key={virtualItem.key}
              className="absolute top-0 left-0 w-full"
              style={{
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <span>Line {virtualItem.index}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
