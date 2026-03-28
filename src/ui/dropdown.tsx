import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Search } from "lucide-react";
import type {
  ForwardRefExoticComponent,
  KeyboardEvent,
  ReactNode,
  RefAttributes,
  RefObject,
} from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { cn } from "@/utils/cn";
import { adjustPositionToFitViewport } from "@/utils/fit-viewport";

type DropdownTriggerProps = {
  onClick?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

interface DropdownProps {
  value: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "xs" | "sm" | "md";
  searchable?: boolean;
  openDirection?: "up" | "down" | "auto";
  CustomTrigger?: ForwardRefExoticComponent<
    DropdownTriggerProps & RefAttributes<HTMLButtonElement>
  >;
  variant?: "default" | "ghost";
}

const Dropdown = ({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  disabled = false,
  size = "sm",
  searchable = false,
  openDirection = "down",
  CustomTrigger,
  variant = "default",
}: DropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useOnClickOutside(dropdownRef as RefObject<HTMLElement>, (event) => {
    const target = event.target as HTMLElement;
    if (target && buttonRef.current?.contains(target)) {
      return;
    }
    setIsOpen(false);
  });

  // Update dropdown position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();

      let yPosition: number;
      if (openDirection === "up") {
        // Position above the button with some spacing
        yPosition = rect.top - 8;
      } else if (openDirection === "down") {
        // Position below the button with some spacing
        yPosition = rect.bottom + 8;
      } else {
        // Auto: choose based on available space
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        yPosition = spaceBelow < 200 && spaceAbove > spaceBelow ? rect.top - 8 : rect.bottom + 8;
      }

      const position = adjustPositionToFitViewport({
        x: rect.left,
        y: yPosition,
        width: rect.width,
        height: rect.height,
      });

      setDropdownPosition({
        top:
          openDirection === "up"
            ? position.y - (dropdownRef.current?.offsetHeight || 200)
            : position.y,
        left: position.x,
        width: rect.width + 48,
      });
      // Focus search input when dropdown opens
      if (searchable && searchInputRef.current) {
        searchInputRef.current.focus();
      }
    } else {
      // Reset search when dropdown closes
      setSearchQuery("");
    }
  }, [isOpen, searchable, openDirection]);

  const selectedOption = options.find((option) => option.value === value);
  const triggerLabel = selectedOption?.label || value || placeholder;

  // Filter options based on search query
  const filteredOptions =
    searchable && searchQuery
      ? options.filter((option) => option.label.toLowerCase().includes(searchQuery.toLowerCase()))
      : options;
  const selectedIndex = filteredOptions.findIndex((option) => option.value === value);

  const sizeClasses = {
    xs: "px-2 py-1 text-xs h-6",
    sm: "px-2 py-1 text-xs h-7",
    md: "px-3 py-1.5 text-sm h-8",
  };

  const iconSizes = {
    xs: "var(--app-ui-icon-size-xs)",
    sm: "var(--app-ui-icon-size-sm)",
    md: "var(--app-ui-icon-size-md)",
  };

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(-1);
      return;
    }

    if (filteredOptions.length === 0) {
      setHighlightedIndex(-1);
      return;
    }

    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [filteredOptions, isOpen, selectedIndex]);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  const moveHighlight = (direction: -1 | 1) => {
    if (filteredOptions.length === 0) {
      return;
    }

    setHighlightedIndex((currentIndex) => {
      if (currentIndex === -1) {
        return selectedIndex >= 0 ? selectedIndex : 0;
      }

      return (currentIndex + direction + filteredOptions.length) % filteredOptions.length;
    });
  };

  const handleSelectHighlighted = () => {
    if (highlightedIndex < 0 || highlightedIndex >= filteredOptions.length) {
      return;
    }

    selectOption(filteredOptions[highlightedIndex].value);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }

      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }

      handleSelectHighlighted();
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      handleSelectHighlighted();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
    }
  };

  const renderDropdown = () => (
    <AnimatePresence>
      {isOpen && !disabled && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, scale: 0.95, y: openDirection === "up" ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: openDirection === "up" ? 4 : -4 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="fixed z-[10040] max-h-96 overflow-auto rounded-xl border border-border bg-primary-bg shadow-xl"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width,
            transformOrigin: openDirection === "up" ? "bottom" : "top",
          }}
        >
          {searchable && (
            <div className="sticky top-0 border-border border-b bg-primary-bg p-2">
              <div className="relative">
                <Search
                  size="var(--app-ui-icon-size-sm)"
                  className="-translate-y-1/2 absolute top-1/2 left-2 text-text-lighter"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="w-full rounded border border-border bg-secondary-bg py-1 pr-2 pl-6 text-text text-xs placeholder-text-lighter focus:border-blue-500 focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-4 text-center text-text-lighter text-xs">
              No matching options
            </div>
          ) : (
            filteredOptions.map((option, index) => (
              <button
                key={option.value}
                type="button"
                onClick={() => selectOption(option.value)}
                className={cn(
                  "w-full px-2 py-1 text-left text-text text-xs transition-colors",
                  "hover:bg-hover",
                  highlightedIndex === index
                    ? "bg-hover"
                    : value === option.value
                      ? "bg-blue-500/20 text-blue-400"
                      : "hover:text-text",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {option.icon}
                  {option.label}
                </span>
              </button>
            ))
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={cn("relative", className)}>
      {CustomTrigger ? (
        <CustomTrigger
          ref={buttonRef}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          onKeyDown={handleTriggerKeyDown}
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          onKeyDown={handleTriggerKeyDown}
          disabled={disabled}
          className={cn(
            "flex w-full items-center justify-between gap-1 rounded-lg text-text transition-colors",
            "focus:outline-none focus:ring-1 focus:ring-accent/50",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover",
            variant === "default" && "border border-border bg-secondary-bg",
            variant === "ghost" && "border-transparent bg-transparent",
            sizeClasses[size],
          )}
        >
          {selectedOption?.icon}
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown
            size={iconSizes[size]}
            className={cn(
              "shrink-0 text-text-lighter transition-transform",
              isOpen && "rotate-180",
            )}
          />
        </button>
      )}
      {typeof document !== "undefined" && createPortal(renderDropdown(), document.body)}
    </div>
  );
};

export default Dropdown;
