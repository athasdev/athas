import React, { useEffect, useMemo, useRef } from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";

interface CompletionDropdownProps {
  items: CompletionItem[];
  selectedIndex: number;
  onSelect: (item: CompletionItem) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

export const CompletionDropdown = React.memo(function CompletionDropdown({
  items,
  selectedIndex,
  onSelect,
  onClose,
  position,
}: CompletionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selectedItem = dropdownRef.current?.children[selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex]);

  // Improved position calculation with better edge detection
  const adjustedPosition = useMemo(() => {
    const dropdownWidth = 320; // Max width of dropdown
    const dropdownHeight = Math.min(items.length * 40, 320); // Estimate height, max 320px
    const padding = 8; // Padding from edges

    let { top, left } = position;

    // Adjust horizontal position if dropdown would go off-screen
    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }

    // Adjust vertical position if dropdown would go off-screen
    if (top + dropdownHeight > window.innerHeight - padding) {
      // Try positioning above the cursor
      const abovePosition = top - dropdownHeight - 20; // 20px offset from cursor
      if (abovePosition >= padding) {
        top = abovePosition;
      } else {
        // If can't fit above, position at bottom with scroll
        top = Math.max(padding, window.innerHeight - dropdownHeight - padding);
      }
    }

    return {
      top: Math.max(padding, top),
      left: Math.max(padding, left),
    };
  }, [position.top, position.left, items.length]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      ref={dropdownRef}
      className="fixed z-[100] bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg shadow-xl scrollbar-hidden"
      style={{
        top: adjustedPosition.top,
        left: adjustedPosition.left,
        maxHeight: "320px",
        minWidth: "260px",
        maxWidth: "400px",
        overflowY: "auto",
        overflowX: "hidden",
        // Ensure proper stacking and visibility
        display: "block",
        visibility: "visible",
        // Add backdrop blur for better visual separation
        backdropFilter: "blur(8px)",
        // Subtle animation
        animation: "fadeInUp 0.15s ease-out",
      }}
    >
      {items.slice(0, 20).map(
        (
          item,
          index, // Limit to 20 items for performance
        ) => (
          <div
            key={`${item.label}-${item.kind}-${index}`}
            className={`px-3 py-2 cursor-pointer flex items-center gap-3 transition-all duration-100 text-sm border-b border-[var(--border-color)] last:border-b-0 ${
              index === selectedIndex
                ? "bg-[var(--selected-color)] text-[var(--text-color)] shadow-sm"
                : "hover:bg-[var(--hover-color)] text-[var(--text-color)]"
            }`}
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(item);
            }}
            onMouseEnter={() => {
              // Optional: Update selected index on hover for better UX
              // setSelectedLspIndex(index);
            }}
          >
            <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center bg-[var(--secondary-bg)] rounded border border-[var(--border-color)] text-xs font-semibold">
              <span className="text-[var(--text-lighter)]">{getCompletionIcon(item.kind)}</span>
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="font-mono text-sm text-[var(--text-color)] truncate font-medium">
                {item.label}
              </div>
              {item.detail && (
                <div className="text-xs text-[var(--text-lighter)] truncate opacity-75 mt-0.5">
                  {item.detail}
                </div>
              )}
            </div>
            <div className="flex-shrink-0">
              <span className="text-xs text-[var(--text-lighter)] opacity-60 font-medium">
                {getCompletionTypeLabel(item.kind)}
              </span>
            </div>
          </div>
        ),
      )}
      {items.length > 20 && (
        <div className="px-3 py-2 text-xs text-[var(--text-lighter)] text-center border-t border-[var(--border-color)] bg-[var(--secondary-bg)]">
          +{items.length - 20} more items...
        </div>
      )}
    </div>
  );
});

function getCompletionIcon(kind?: number): string {
  switch (kind) {
    case 1:
      return "T"; // Text
    case 2:
      return "M"; // Method
    case 3:
      return "f"; // Function
    case 4:
      return "C"; // Constructor
    case 5:
      return "F"; // Field
    case 6:
      return "v"; // Variable
    case 7:
      return "C"; // Class
    case 8:
      return "I"; // Interface
    case 9:
      return "M"; // Module
    case 10:
      return "p"; // Property
    case 11:
      return "U"; // Unit
    case 12:
      return "V"; // Value
    case 13:
      return "E"; // Enum
    case 14:
      return "k"; // Keyword
    case 15:
      return "S"; // Snippet
    case 16:
      return "🎨"; // Color
    case 17:
      return "📄"; // File
    case 18:
      return "R"; // Reference
    case 19:
      return "📁"; // Folder
    case 20:
      return "e"; // EnumMember
    case 21:
      return "c"; // Constant
    case 22:
      return "S"; // Struct
    case 23:
      return "⚡"; // Event
    case 24:
      return "⊕"; // Operator
    case 25:
      return "T"; // TypeParameter
    default:
      return "?";
  }
}

function getCompletionTypeLabel(kind?: number): string {
  switch (kind) {
    case 1:
      return "text";
    case 2:
      return "method";
    case 3:
      return "function";
    case 4:
      return "constructor";
    case 5:
      return "field";
    case 6:
      return "variable";
    case 7:
      return "class";
    case 8:
      return "interface";
    case 9:
      return "module";
    case 10:
      return "property";
    case 11:
      return "unit";
    case 12:
      return "value";
    case 13:
      return "enum";
    case 14:
      return "keyword";
    case 15:
      return "snippet";
    case 16:
      return "color";
    case 17:
      return "file";
    case 18:
      return "reference";
    case 19:
      return "folder";
    case 20:
      return "enum member";
    case 21:
      return "constant";
    case 22:
      return "struct";
    case 23:
      return "event";
    case 24:
      return "operator";
    case 25:
      return "type param";
    default:
      return "unknown";
  }
}
