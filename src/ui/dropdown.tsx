import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import { ChevronDown, Search } from "lucide-react";
import type {
  CSSProperties,
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

type SelectOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

type MenuAnchorSide = "top" | "bottom";
type MenuAnchorAlign = "start" | "center" | "end";

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: ReactNode;
  keybinding?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
  className?: string;
}

interface SelectDropdownProps {
  value: string;
  options: SelectOption[];
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

interface MenuDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  children?: ReactNode;
  items?: MenuItem[];
  point?: { x: number; y: number };
  anchorRef?: RefObject<HTMLElement | null>;
  anchorSide?: MenuAnchorSide;
  anchorAlign?: MenuAnchorAlign;
  className?: string;
  style?: CSSProperties;
}

interface MenuPopoverProps extends Omit<HTMLMotionProps<"div">, "children" | "style" | "ref"> {
  isOpen: boolean;
  menuRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

type DropdownProps = SelectDropdownProps | MenuDropdownProps;

const MENU_VIEWPORT_MARGIN = 8;

export const dropdownTriggerClassName = (className?: string) =>
  cn(
    "ui-font inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 font-medium text-text-lighter transition-colors hover:bg-hover hover:text-text",
    className,
  );

export const dropdownItemClassName = (className?: string) =>
  cn(
    "ui-font flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs text-text transition-colors hover:bg-hover",
    className,
  );

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

const setRefValue = <T,>(ref: RefObject<T | null> | undefined, value: T | null) => {
  if (!ref) {
    return;
  }

  (ref as { current: T | null }).current = value;
};

const getMenuCoordinates = (
  menuWidth: number,
  menuHeight: number,
  point?: { x: number; y: number },
  anchor?: {
    ref?: RefObject<HTMLElement | null>;
    side?: MenuAnchorSide;
    align?: MenuAnchorAlign;
  },
) => {
  if (point) {
    return adjustPositionToFitViewport({
      x: point.x,
      y: point.y,
      width: menuWidth,
      height: menuHeight,
    });
  }

  const anchorElement = anchor?.ref?.current;
  if (!anchorElement) {
    return null;
  }

  const rect = anchorElement.getBoundingClientRect();
  const side = anchor?.side ?? "bottom";
  const align = anchor?.align ?? "start";

  let x = rect.left;
  if (align === "center") {
    x = rect.left + (rect.width - menuWidth) / 2;
  } else if (align === "end") {
    x = rect.right - menuWidth;
  }

  const y = side === "top" ? rect.top - menuHeight - 8 : rect.bottom + 8;

  return adjustPositionToFitViewport({
    x,
    y,
    width: menuWidth,
    height: menuHeight,
  });
};

export const MenuItemsList = ({
  items,
  onItemSelect,
}: {
  items: MenuItem[];
  onItemSelect?: () => void;
}) => (
  <div className="space-y-1">
    {items.map((item) => {
      if (item.separator) {
        return <div key={item.id} className="my-1 border-border/60 border-t" />;
      }

      return (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            if (item.disabled) {
              return;
            }
            item.onClick();
            onItemSelect?.();
          }}
          disabled={item.disabled}
          className={dropdownItemClassName(
            cn(
              item.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
              item.className,
            ),
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {item.icon}
            <span className="truncate">{item.label}</span>
          </span>
          {(item.shortcut || item.keybinding) && (
            <span className="text-text-lighter">{item.shortcut ?? item.keybinding}</span>
          )}
        </button>
      );
    })}
  </div>
);

export const MenuPopover = ({
  isOpen,
  menuRef,
  children,
  className,
  style,
  ...motionProps
}: MenuPopoverProps) => {
  const localRef = useRef<HTMLDivElement>(null);

  return (
    <AnimatePresence>
      {isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <motion.div
            ref={(node) => {
              localRef.current = node;
              setRefValue(menuRef, node);
            }}
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className={cn(
              "fixed z-[10040] overflow-auto rounded-xl border border-border bg-primary-bg shadow-xl",
              className,
            )}
            style={style}
            {...motionProps}
          >
            {children}
          </motion.div>,
          document.body,
        )}
    </AnimatePresence>
  );
};

const isMenuDropdownProps = (props: DropdownProps): props is MenuDropdownProps =>
  "isOpen" in props || "items" in props || "anchorRef" in props || "point" in props;

const SelectDropdown = ({
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
}: SelectDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
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

  useEffect(() => {
    if (!isOpen || !buttonRef.current) {
      setSearchQuery("");
      return;
    }

    const rect = buttonRef.current.getBoundingClientRect();
    const y =
      openDirection === "up"
        ? rect.top - 8
        : openDirection === "down"
          ? rect.bottom + 8
          : window.innerHeight - rect.bottom < 200 && rect.top > window.innerHeight - rect.bottom
            ? rect.top - 8
            : rect.bottom + 8;

    const position = adjustPositionToFitViewport({
      x: rect.left,
      y,
      width: rect.width + 48,
      height: dropdownRef.current?.offsetHeight || 200,
    });

    setDropdownPosition({
      top:
        openDirection === "up"
          ? position.y - (dropdownRef.current?.offsetHeight || 200)
          : position.y,
      left: position.x,
      width: rect.width + 48,
    });

    if (searchable) {
      searchInputRef.current?.focus();
    }
  }, [isOpen, searchable, openDirection]);

  const selectedOption = options.find((option) => option.value === value);
  const triggerLabel = selectedOption?.label || value || placeholder;
  const filteredOptions =
    searchable && searchQuery
      ? options.filter((option) => option.label.toLowerCase().includes(searchQuery.toLowerCase()))
      : options;
  const selectedIndex = filteredOptions.findIndex((option) => option.value === value);

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

  const dropdown = (
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
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search..."
                  className="w-full rounded border border-border bg-secondary-bg py-1 pr-2 pl-6 text-text text-xs placeholder-text-lighter focus:border-blue-500 focus:outline-none"
                  onClick={(event) => event.stopPropagation()}
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
      {typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </div>
  );
};

const MenuDropdown = ({
  isOpen,
  onClose,
  children,
  items,
  point,
  anchorRef,
  anchorSide = "bottom",
  anchorAlign = "start",
  className,
  style,
}: MenuDropdownProps) => {
  const localMenuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useOnClickOutside(localMenuRef as RefObject<HTMLElement>, (event) => {
    if (!isOpen) {
      return;
    }

    const target = event.target as HTMLElement;
    if (anchorRef?.current?.contains(target)) {
      return;
    }

    onClose();
  });

  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const menu = localMenuRef.current;
      if (!menu) {
        return;
      }

      const nextPosition = getMenuCoordinates(
        menu.offsetWidth || 200,
        menu.offsetHeight || 200,
        point,
        {
          ref: anchorRef,
          side: anchorSide,
          align: anchorAlign,
        },
      );
      setPosition(nextPosition ? { left: nextPosition.x, top: nextPosition.y } : null);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorAlign, anchorRef, anchorSide, isOpen, point]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <MenuPopover
      isOpen={isOpen}
      menuRef={localMenuRef}
      initial={{ opacity: 0, scale: 0.96, y: anchorSide === "top" ? 4 : -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: anchorSide === "top" ? 4 : -4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={cn("min-w-[180px] p-1.5", className)}
      style={{
        left: `${position?.left ?? MENU_VIEWPORT_MARGIN}px`,
        top: `${position?.top ?? MENU_VIEWPORT_MARGIN}px`,
        ...style,
      }}
    >
      {items ? <MenuItemsList items={items} onItemSelect={onClose} /> : children}
    </MenuPopover>
  );
};

const DropdownComponent = (props: DropdownProps) =>
  isMenuDropdownProps(props) ? <MenuDropdown {...props} /> : <SelectDropdown {...props} />;

export const Dropdown = DropdownComponent;

export default DropdownComponent;
