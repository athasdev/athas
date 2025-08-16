import { ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

interface DropdownProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "xs" | "sm" | "md";
  searchable?: boolean;
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Update dropdown position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
      // Focus search input when dropdown opens
      if (searchable && searchInputRef.current) {
        searchInputRef.current.focus();
      }
    } else {
      // Reset search when dropdown closes
      setSearchQuery("");
    }
  }, [isOpen, searchable]);

  const selectedOption = options.find((option) => option.value === value);

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
    xs: 10,
    sm: 12,
    md: 14,
  };

  const renderDropdown = () => {
    if (!isOpen || disabled) return null;

    return (
      <div
        ref={dropdownRef}
        className={cn(
          "fixed z-[9999] max-h-96 min-w-max max-w-xs overflow-auto",
          "rounded border border-border bg-primary-bg shadow-xl",
          searchable ? "pt-0" : "py-1",
        )}
        style={{
          top: dropdownPosition.top,
          left: dropdownPosition.left,
          minWidth: dropdownPosition.width,
        }}
      >
        {searchable && (
          <div className="sticky top-0 border-border border-b bg-primary-bg p-2">
            <div className="relative">
              <Search
                size={12}
                className="-translate-y-1/2 absolute top-1/2 left-2 text-text-lighter"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search fonts..."
                className="w-full rounded border border-border bg-secondary-bg py-1 pr-2 pl-6 text-text text-xs placeholder-text-lighter focus:border-blue-500 focus:outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}
        {filteredOptions.length === 0 ? (
          <div className="px-2 py-4 text-center text-text-lighter text-xs">No matching options</div>
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
              {option.label}
            </button>
          ))
        )}
      </div>
    );
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          "flex w-full items-center justify-between gap-1 rounded border border-border bg-secondary-bg text-text transition-colors",
          "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover",
          sizeClasses[size],
        )}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown
          size={iconSizes[size]}
          className={cn(
            "flex-shrink-0 text-text-lighter transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {typeof document !== "undefined" && createPortal(renderDropdown(), document.body)}
    </div>
  );
};

export default Dropdown;
