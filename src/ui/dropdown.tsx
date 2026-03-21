import { AnimatePresence, motion } from "framer-motion";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Input from "@/ui/input";
import type { MenuItem } from "@/ui/menu";
import { cn } from "@/utils/cn";
import { Search } from "lucide-react";

export const DROPDOWN_TRIGGER_BASE =
  "ui-font flex h-6 min-w-0 items-center gap-1 rounded-lg border border-transparent px-2 text-xs text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text disabled:opacity-50";

export const DROPDOWN_ITEM_BASE =
  "ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs transition-colors hover:bg-hover";

export function dropdownTriggerClassName(className?: string) {
  return cn(DROPDOWN_TRIGGER_BASE, className);
}

export function dropdownItemClassName(className?: string) {
  return cn(DROPDOWN_ITEM_BASE, className);
}

export interface DropdownSection {
  id: string;
  label?: string;
  items: MenuItem[];
}

type AnchorSide = "top" | "bottom";
type AnchorAlign = "start" | "end";

interface DropdownBaseProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
}

interface AnchorPositioning {
  anchorRef: RefObject<HTMLElement | null>;
  anchorSide?: AnchorSide;
  anchorAlign?: AnchorAlign;
  point?: never;
}

interface PointPositioning {
  point: { x: number; y: number };
  anchorRef?: never;
  anchorSide?: never;
  anchorAlign?: never;
}

type PositioningProps = AnchorPositioning | PointPositioning;

interface ItemsContent {
  items: MenuItem[];
  sections?: never;
  children?: never;
  searchable?: boolean;
  searchPlaceholder?: string;
}

interface SectionsContent {
  sections: DropdownSection[];
  items?: never;
  children?: never;
  searchable?: boolean;
  searchPlaceholder?: string;
}

interface ChildrenContent {
  children: ReactNode;
  items?: never;
  sections?: never;
  searchable?: never;
  searchPlaceholder?: never;
}

type ContentProps = ItemsContent | SectionsContent | ChildrenContent;

export type DropdownProps = DropdownBaseProps & PositioningProps & ContentProps;

const VIEWPORT_PADDING = 8;

function getViewportBounds() {
  const vv = window.visualViewport;
  if (!vv || !Number.isFinite(vv.width) || !Number.isFinite(vv.height)) {
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  return {
    left: Number.isFinite(vv.offsetLeft) ? vv.offsetLeft : 0,
    top: Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0,
    width: vv.width,
    height: vv.height,
  };
}

export function Dropdown(props: DropdownProps) {
  const { isOpen, onClose, className, style, searchable, searchPlaceholder } = props;

  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);
  const [resolvedSide, setResolvedSide] = useState<AnchorSide>("bottom");

  const isAnchorMode = "anchorRef" in props && props.anchorRef != null;
  const anchorRef = isAnchorMode ? (props as AnchorPositioning).anchorRef : null;
  const anchorSide = isAnchorMode
    ? ((props as AnchorPositioning).anchorSide ?? "bottom")
    : "bottom";
  const anchorAlign = isAnchorMode
    ? ((props as AnchorPositioning).anchorAlign ?? "start")
    : "start";
  const point = !isAnchorMode ? (props as PointPositioning).point : null;

  const hasItems = "items" in props && props.items != null;
  const hasSections = "sections" in props && props.sections != null;
  const hasChildren = "children" in props && props.children != null;

  const getAllItems = useCallback((): MenuItem[] => {
    if (hasItems) return props.items!;
    if (hasSections) return props.sections!.flatMap((s) => s.items);
    return [];
  }, [hasItems, hasSections, props]);

  const getFilteredItems = useCallback((): MenuItem[] => {
    const all = getAllItems();
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((item) => !item.separator && item.label.toLowerCase().includes(q));
  }, [getAllItems, searchQuery]);

  const getFilteredSections = useCallback((): DropdownSection[] => {
    if (!hasSections) return [];
    if (!searchQuery.trim()) return props.sections!;
    const q = searchQuery.toLowerCase();
    return props
      .sections!.map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => !item.separator && item.label.toLowerCase().includes(q),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [hasSections, searchQuery, props]);

  const positionMenu = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const vp = getViewportBounds();
    const maxH = Math.max(120, vp.height - VIEWPORT_PADDING * 2);
    menu.style.maxHeight = `${maxH}px`;

    const menuRect = menu.getBoundingClientRect();

    let x: number;
    let y: number;
    let finalSide: AnchorSide = "bottom";

    if (anchorRef?.current) {
      const anchorRect = anchorRef.current.getBoundingClientRect();

      if (anchorAlign === "end") {
        x = anchorRect.right - menuRect.width;
      } else {
        x = anchorRect.left;
      }

      const spaceBelow = vp.top + vp.height - anchorRect.bottom - VIEWPORT_PADDING;
      const spaceAbove = anchorRect.top - vp.top - VIEWPORT_PADDING;

      if (anchorSide === "bottom") {
        if (menuRect.height <= spaceBelow || spaceBelow >= spaceAbove) {
          y = anchorRect.bottom + 6;
          finalSide = "bottom";
        } else {
          y = anchorRect.top - menuRect.height - 6;
          finalSide = "top";
        }
      } else {
        if (menuRect.height <= spaceAbove || spaceAbove >= spaceBelow) {
          y = anchorRect.top - menuRect.height - 6;
          finalSide = "top";
        } else {
          y = anchorRect.bottom + 6;
          finalSide = "bottom";
        }
      }
    } else if (point) {
      x = point.x;
      y = point.y;

      if (x + menuRect.width > vp.left + vp.width - VIEWPORT_PADDING) {
        x = point.x - menuRect.width;
      }
      if (y + menuRect.height > vp.top + vp.height - VIEWPORT_PADDING) {
        y = point.y - menuRect.height;
      }
    } else {
      return;
    }

    const minX = vp.left + VIEWPORT_PADDING;
    const maxX = vp.left + vp.width - menuRect.width - VIEWPORT_PADDING;
    const minY = vp.top + VIEWPORT_PADDING;
    const maxY = vp.top + vp.height - menuRect.height - VIEWPORT_PADDING;

    x = Math.max(minX, Math.min(x, maxX));
    y = Math.max(minY, Math.min(y, maxY));

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    setResolvedSide(finalSide);
  }, [anchorRef, anchorSide, anchorAlign, point]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(positionMenu);
    return () => cancelAnimationFrame(frame);
  }, [isOpen, positionMenu, searchQuery]);

  useEffect(() => {
    if (!isOpen) return;

    const resizeObserver = new ResizeObserver(positionMenu);
    if (menuRef.current) resizeObserver.observe(menuRef.current);

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    window.visualViewport?.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("scroll", positionMenu);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      window.visualViewport?.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("scroll", positionMenu);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose, positionMenu, anchorRef]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setFocusIndex(-1);
      if (searchable) {
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    }
  }, [isOpen, searchable]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = getFilteredItems().filter((item) => !item.separator && !item.disabled);
      if (items.length === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setFocusIndex((prev) => (prev + 1) % items.length);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setFocusIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
          break;
        }
        case "Home": {
          e.preventDefault();
          setFocusIndex(0);
          break;
        }
        case "End": {
          e.preventDefault();
          setFocusIndex(items.length - 1);
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (focusIndex >= 0 && focusIndex < items.length) {
            items[focusIndex].onClick();
            onClose();
          }
          break;
        }
      }
    },
    [getFilteredItems, focusIndex, onClose],
  );

  if (typeof document === "undefined") return null;

  const originMap: Record<string, string> = {
    "bottom-start": "top left",
    "bottom-end": "top right",
    "top-start": "bottom left",
    "top-end": "bottom right",
  };
  const transformOrigin =
    originMap[`${resolvedSide}-${anchorAlign}`] ?? (point ? "top left" : "top left");

  const yDir = resolvedSide === "top" ? 4 : -4;

  const node = isOpen ? (
    <motion.div
      ref={menuRef}
      role="menu"
      initial={{ opacity: 0, scale: 0.95, y: yDir }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: yDir }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className={cn(
        "fixed z-[10040] min-w-[190px] max-w-[min(420px,calc(100vw-16px))] select-none overflow-y-auto rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm",
        className,
      )}
      style={{ transformOrigin, ...style }}
      onKeyDown={handleKeyDown}
    >
      {searchable && (
        <div className="px-1 pb-1">
          <Input
            ref={searchRef}
            type="text"
            placeholder={searchPlaceholder ?? "Search..."}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setFocusIndex(-1);
            }}
            leftIcon={Search}
            variant="ghost"
            className="w-full"
          />
        </div>
      )}
      {hasChildren && (props as ChildrenContent).children}
      {hasItems && (
        <DropdownItemsList items={getFilteredItems()} focusIndex={focusIndex} onClose={onClose} />
      )}
      {hasSections &&
        getFilteredSections().map((section, sectionIdx) => (
          <div key={section.id}>
            {sectionIdx > 0 && <div className="my-0.5 border-border/70 border-t" />}
            {section.label && (
              <div className="ui-font px-2.5 py-1 text-[10px] text-text-lighter">
                {section.label}
              </div>
            )}
            <DropdownItemsList items={section.items} focusIndex={-1} onClose={onClose} />
          </div>
        ))}
    </motion.div>
  ) : null;

  return createPortal(<AnimatePresence>{node}</AnimatePresence>, document.body);
}

function DropdownItemsList({
  items,
  focusIndex,
  onClose,
}: {
  items: MenuItem[];
  focusIndex: number;
  onClose: () => void;
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (focusIndex >= 0 && itemRefs.current[focusIndex]) {
      itemRefs.current[focusIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex]);

  let selectableIdx = -1;
  return (
    <div>
      {items.map((item) => {
        if (item.separator) {
          return <div key={item.id} className="my-0.5 border-border/70 border-t" />;
        }

        selectableIdx++;
        const isFocused = selectableIdx === focusIndex;

        return (
          <button
            key={item.id}
            ref={(el) => {
              if (!item.disabled) {
                itemRefs.current[selectableIdx] = el;
              }
            }}
            type="button"
            role="menuitem"
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
            disabled={item.disabled}
            className={cn(
              "ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs transition-colors",
              item.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover",
              isFocused && "bg-hover",
              item.className,
            )}
          >
            {item.icon && <span className="size-3 shrink-0">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.keybinding && (
              <span className="shrink-0 text-text-lighter text-xs">{item.keybinding}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
