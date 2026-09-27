import {
  memo,
  type ReactNode,
  type Ref,
  type RefCallback,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FileNavigatorSidebar,
  type FileNavigatorItem,
  type FileNavigatorTone,
  type FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { ScrollArea } from "@/ui/scroll-area";
import { cn } from "@/utils/cn";
import { getBaseName, getDirName } from "@/utils/path-helpers";
import { MultibufferFileHeader } from "./multibuffer-file-header";
import { MultibufferNavigatorToggle } from "./multibuffer-navigator-toggle";

/**
 * One file's slice of a multibuffer: a sticky header plus a lazily mounted body.
 * `key` doubles as the navigator key, so selecting a file in the navigator or
 * the stepper scrolls straight to its section.
 */
export interface MultibufferSection {
  key: string;
  path: string;
  label?: string;
  iconPath?: string;
  iconTone?: FileNavigatorTone;
  metadata?: FileNavigatorItem["metadata"];
  trailing?: ReactNode;
  actions?: ReactNode;
  onOpen?: () => void;
  openAriaLabel?: string;
  estimatedHeight?: number;
  render: () => ReactNode;
}

export interface MultibufferHeader {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
}

export interface MultibufferWorkspaceHandle {
  scrollToSection: (key: string, align?: "start" | "nearest") => void;
}

interface MultibufferWorkspaceProps {
  sections: MultibufferSection[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onActiveKeyChange?: (key: string | null) => void;
  navigatorLabel: string;
  navigatorItems?: FileNavigatorItem[];
  navigatorOpen: boolean;
  onNavigatorOpenChange: (open: boolean) => void;
  navigatorViewMode: FileNavigatorViewMode;
  onNavigatorViewModeChange: (viewMode: FileNavigatorViewMode) => void;
  navigatorSearchResetKey?: string;
  /** Compact pane header; omit when the owner renders its own toolbar with the Files toggle. */
  header?: MultibufferHeader;
  /** Floating content laid over the scroll area, e.g. a find popover. */
  overlay?: ReactNode;
  scrollContainerRef?: RefCallback<HTMLDivElement>;
  emptyState?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  ref?: Ref<MultibufferWorkspaceHandle>;
}

const SECTION_MOUNT_MARGIN = "1200px 0px";
const INITIALLY_MOUNTED_SECTIONS = 4;
const DEFAULT_SECTION_HEIGHT = 240;

export function getMultibufferSectionSelector(key: string) {
  const escaped = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[data-multibuffer-section="${escaped}"]`;
}

function toNavigatorItem(section: MultibufferSection): FileNavigatorItem {
  return {
    key: section.key,
    path: section.path,
    label: section.label,
    iconPath: section.iconPath,
    iconTone: section.iconTone,
    metadata: section.metadata,
  };
}

interface MultibufferSectionViewProps {
  section: MultibufferSection;
  index: number;
  scrollElement: HTMLDivElement | null;
  collapsed: boolean;
  onToggle: (key: string) => void;
  onOpen: (key: string) => void;
}

const MultibufferSectionView = memo(function MultibufferSectionView({
  section,
  index,
  scrollElement,
  collapsed,
  onToggle,
  onOpen,
}: MultibufferSectionViewProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const measuredHeightRef = useRef<number | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(
    () => typeof IntersectionObserver === "undefined" || index < INITIALLY_MOUNTED_SECTIONS,
  );
  const fileName = getBaseName(section.path, section.path);
  const directoryPath = getDirName(section.path);

  useEffect(() => {
    const element = sectionRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setIsNearViewport(entry.isIntersecting);
      },
      { root: scrollElement, rootMargin: SECTION_MOUNT_MARGIN },
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, [scrollElement]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !isNearViewport || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      measuredHeightRef.current = body.offsetHeight;
    });
    observer.observe(body);
    measuredHeightRef.current = body.offsetHeight;

    return () => observer.disconnect();
  }, [isNearViewport, collapsed]);

  const placeholderHeight =
    measuredHeightRef.current ?? section.estimatedHeight ?? DEFAULT_SECTION_HEIGHT;

  return (
    <section
      ref={sectionRef}
      data-multibuffer-section={section.key}
      data-multibuffer-index={index}
      className="relative min-w-0 max-w-full border-border border-b bg-background"
    >
      <MultibufferFileHeader
        filePath={section.path}
        fileName={fileName}
        directoryPath={directoryPath || undefined}
        expanded={!collapsed}
        onToggle={() => onToggle(section.key)}
        onOpen={() => onOpen(section.key)}
        openAriaLabel={section.openAriaLabel}
        trailing={section.trailing}
        actions={section.actions}
      />
      {collapsed ? null : isNearViewport ? (
        <div ref={bodyRef} className="min-w-0 max-w-full overflow-hidden">
          {section.render()}
        </div>
      ) : (
        <div aria-hidden="true" style={{ height: placeholderHeight }} />
      )}
    </section>
  );
});

/**
 * The one shell for every "many files in one scroll" surface: diff reviews,
 * search results, diagnostics. It owns the scroll container, stacks each file
 * under a sticky header, keeps the docked file navigator in sync with
 * whichever section is at the top, and lazily mounts section bodies so a
 * thousand-file review stays responsive.
 */
export function MultibufferWorkspace({
  sections,
  selectedKey,
  onSelect,
  onActiveKeyChange,
  navigatorLabel,
  navigatorItems,
  navigatorOpen,
  onNavigatorOpenChange,
  navigatorViewMode,
  onNavigatorViewModeChange,
  navigatorSearchResetKey,
  header,
  overlay,
  scrollContainerRef,
  emptyState,
  footer,
  children,
  className,
  ref,
}: MultibufferWorkspaceProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [activeKey, setActiveKey] = useState<string | null>(selectedKey);
  const lastRequestedKeyRef = useRef<string | null>(null);
  const items = useMemo(
    () => navigatorItems ?? sections.map(toNavigatorItem),
    [navigatorItems, sections],
  );
  const hasItems = items.length > 0;
  const showNavigator = navigatorOpen && hasItems;

  const setScrollContainer = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      setScrollElement((current) => (current === element ? current : element));
      scrollContainerRef?.(element);
    },
    [scrollContainerRef],
  );

  const scrollToSection = useCallback(
    (key: string, align: "start" | "nearest" = "start") => {
      const container = scrollElement;
      if (!container) return;
      const target = container.querySelector<HTMLElement>(getMultibufferSectionSelector(key));
      if (!target) return;

      if (align === "nearest") {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }

      const offset =
        target.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: offset, left: 0 });
      } else {
        container.scrollTop = offset;
      }
    },
    [scrollElement],
  );

  useImperativeHandle(ref, () => ({ scrollToSection }), [scrollToSection]);

  const selectSection = useCallback(
    (key: string) => {
      lastRequestedKeyRef.current = key;
      setActiveKey(key);
      onSelect(key);
      scrollToSection(key);
    },
    [onSelect, scrollToSection],
  );

  const toggleSection = useCallback((key: string) => {
    setCollapsedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openSection = useCallback(
    (key: string) => {
      const section = sections.find((candidate) => candidate.key === key);
      if (section?.onOpen) {
        section.onOpen();
        return;
      }
      selectSection(key);
    },
    [sections, selectSection],
  );

  useEffect(() => {
    if (!selectedKey || selectedKey === lastRequestedKeyRef.current) return;
    lastRequestedKeyRef.current = selectedKey;
    setActiveKey(selectedKey);
    scrollToSection(selectedKey);
  }, [scrollToSection, selectedKey]);

  useEffect(() => {
    if (!scrollElement || sections.length === 0) return;

    let frame: number | null = null;
    const updateActiveSection = () => {
      frame = null;
      const containerTop = scrollElement.getBoundingClientRect().top;
      let nextKey: string | null = null;

      for (const section of sections) {
        const element = scrollElement.querySelector<HTMLElement>(
          getMultibufferSectionSelector(section.key),
        );
        if (!element) continue;
        if (element.getBoundingClientRect().top - containerTop <= 1) {
          nextKey = section.key;
        } else {
          break;
        }
      }

      setActiveKey(nextKey ?? sections[0]?.key ?? null);
    };
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(updateActiveSection);
    };

    scrollElement.addEventListener("scroll", scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      scrollElement.removeEventListener("scroll", scheduleUpdate);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [scrollElement, sections]);

  useEffect(() => {
    onActiveKeyChange?.(activeKey);
  }, [activeKey, onActiveKeyChange]);

  const highlightedKey = activeKey ?? selectedKey;

  return (
    <div
      data-slot="multibuffer-workspace"
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        className,
      )}
    >
      {header ? (
        <PaneContentHeader
          className="select-none"
          leading={header.icon}
          title={header.title}
          detail={header.detail}
          actions={
            <>
              <MultibufferNavigatorToggle
                open={navigatorOpen}
                onOpenChange={onNavigatorOpenChange}
                disabled={!hasItems}
                count={items.length}
              />
              {header.actions ? (
                <>
                  <div className="mx-1 h-3.5 w-px bg-border" />
                  {header.actions}
                </>
              ) : null}
            </>
          }
        />
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ScrollArea
            fill="flex"
            className="isolate bg-background"
            contentClassName="min-h-full pb-24"
            scrollbarVisibility="always"
            reserveScrollbarGutter
            viewportProps={{
              ref: setScrollContainer,
              style: { overflowAnchor: "none" },
              "data-multibuffer-scroll-container": "",
            }}
          >
            {children ??
              (sections.length === 0
                ? emptyState
                : sections.map((section, index) => (
                    <MultibufferSectionView
                      key={section.key}
                      section={section}
                      index={index}
                      scrollElement={scrollElement}
                      collapsed={collapsedKeys.has(section.key)}
                      onToggle={toggleSection}
                      onOpen={openSection}
                    />
                  )))}
            {footer}
          </ScrollArea>

          {overlay}
        </div>
        {showNavigator ? (
          <FileNavigatorSidebar
            items={items}
            selectedKey={highlightedKey}
            onSelect={selectSection}
            ariaLabel={navigatorLabel}
            viewMode={navigatorViewMode}
            onViewModeChange={onNavigatorViewModeChange}
            searchMode="fuzzy"
            searchResetKey={navigatorSearchResetKey}
            compactRows
            resizeEdge="left"
          />
        ) : null}
      </div>
    </div>
  );
}
