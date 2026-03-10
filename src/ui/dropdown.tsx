import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Search } from "lucide-react";
import type { FC, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { cn } from "@/utils/cn";
import { adjustPositionToFitViewport } from "@/utils/fit-viewport";

interface DropdownProps {
  value: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
  size?: "xs" | "sm" | "md";
  searchable?: boolean;
  openDirection?: "up" | "down" | "auto";
  CustomTrigger?: FC<{
    ref: RefObject<HTMLButtonElement | null>;
    onClick: () => void;
  }>;
}

const Dropdown = ({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  menuClassName = "",
  disabled = false,
  size = "sm",
  searchable = false,
  openDirection = "down",
  CustomTrigger,
}: DropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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

  const renderDropdown = () => (
    <AnimatePresence>
      {isOpen && !disabled && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, scale: 0.95, y: openDirection === "up" ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: openDirection === "up" ? 4 : -4 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className={cn(
            "fixed z-[10040] max-h-96 overflow-auto rounded-xl border border-border bg-primary-bg shadow-xl",
            menuClassName,
          )}
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
                />
              </div>
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-4 text-center text-text-lighter text-xs">
              No matching options
            </div>
          ) : (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full px-2 py-1 text-left text-text text-xs transition-colors",
                  "hover:bg-hover",
                  value === option.value ? "bg-blue-500/20 text-blue-400" : "hover:text-text",
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
        <CustomTrigger ref={buttonRef} onClick={() => !disabled && setIsOpen(!isOpen)} />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            "flex w-full items-center justify-between gap-1 rounded-lg border border-border bg-secondary-bg text-text transition-colors",
            "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover",
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
