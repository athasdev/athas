import {
  type CSSProperties,
  Fragment,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AGENT_SESSION_CHAT_ATTRIBUTE } from "@/features/ai/session-panel/services/session-links";
import { getDockSessionInfo } from "@/features/layout/services/dock-pane-registry";
import {
  getDockPaneShares,
  MIN_DOCK_WIDTH,
  useDockLayout,
  useDockLayoutStore,
} from "@/features/layout/stores/dock-layout.store";
import type { DockOwner } from "@/features/layout/types/dock.types";
import { PaneResizeHandle } from "@/features/panes/components/pane-resize-handle";
import { Pane } from "@/ui/pane";
import { MERGED_TITLE_ROW } from "@/features/window/services/title-row";
import { cn } from "@/utils/cn";
import { DockAddPaneMenu } from "./dock-add-pane-menu";
import { DockPaneFrame } from "./dock-pane-frame";
import { useDockPaneViews } from "./use-dock-pane-views";

/** The centre keeps at least this much room beside the dock. */
const MIN_CENTRE_WIDTH = 360;

function useDockWidthDrag() {
  const { setWidth } = useDockLayoutStore.use.actions();
  const [dragging, setDragging] = useState(false);
  const onMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      const dock = event.currentTarget.parentElement;
      if (!dock) return;
      const startX = event.clientX;
      const startWidth = dock.getBoundingClientRect().width;
      const maxWidth = Math.max(MIN_DOCK_WIDTH, window.innerWidth - MIN_CENTRE_WIDTH);
      let width = startWidth;
      setDragging(true);
      const onMove = (move: MouseEvent) => {
        width = Math.min(maxWidth, Math.max(MIN_DOCK_WIDTH, startWidth - (move.clientX - startX)));
        dock.style.setProperty("--dock-width", `${Math.round(width)}px`);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setDragging(false);
        setWidth(width);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [setWidth],
  );
  return { dragging, onMouseDown };
}

function SessionInfo({ chatId, compact }: { chatId: string; compact: boolean }) {
  const info = getDockSessionInfo();
  const owner: DockOwner = { kind: "session", id: chatId };
  const layout = useDockLayout(owner);
  const { setInfoExpanded } = useDockLayoutStore.use.actions();
  if (!info) return null;
  const { Column, Summary } = info;
  if (!compact) {
    return (
      <Pane surface="island" data-slot="dock-session-info" className="flex-1">
        <Column chatId={chatId} />
      </Pane>
    );
  }
  return (
    <Pane
      surface="island"
      data-slot="dock-session-info"
      data-expanded={layout.infoExpanded || undefined}
      className="max-h-[45%] shrink-0"
    >
      <Summary
        chatId={chatId}
        expanded={layout.infoExpanded}
        onToggle={() => setInfoExpanded(owner, !layout.infoExpanded)}
      />
      {layout.infoExpanded ? <Column chatId={chatId} /> : null}
    </Pane>
  );
}

const noSessionInfo = () => false;

function SessionDock({ chatId }: { chatId: string }) {
  const useHasContent = getDockSessionInfo()?.useHasContent ?? noSessionInfo;
  const hasInfo = useHasContent(chatId);
  return <Dock owner={{ kind: "session", id: chatId }} hasInfo={hasInfo} />;
}

/** How long the dock takes to slide out or away; matches `duration-fast`. */
const DOCK_TOGGLE_MS = 150;

/**
 * Keeps the dock mounted while it slides away, and marks the renders where it slides, so only a
 * show or hide animates: switching sessions or projects swaps the dock at once.
 */
function useDockPresence(shown: boolean) {
  const [present, setPresent] = useState(shown);
  const [toggling, setToggling] = useState(false);
  const [previousShown, setPreviousShown] = useState(shown);
  if (previousShown !== shown) {
    setPreviousShown(shown);
    setToggling(true);
    if (shown) setPresent(true);
  }
  useEffect(() => {
    if (!toggling) return;
    const timer = window.setTimeout(() => {
      setToggling(false);
      if (!shown) setPresent(false);
    }, DOCK_TOGGLE_MS + 30);
    return () => window.clearTimeout(timer);
  }, [shown, toggling]);
  return { present, toggling };
}

function Dock({ owner, hasInfo }: { owner: DockOwner; hasInfo: boolean }) {
  const layout = useDockLayout(owner);
  const hidden = useDockLayoutStore.use.hidden();
  const width = useDockLayoutStore.use.width();
  const actions = useDockLayoutStore.use.actions();
  const views = useDockPaneViews(owner);
  const { dragging, onMouseDown } = useDockWidthDrag();
  const stackRef = useRef<HTMLDivElement>(null);
  const [initialPanes] = useState(() => new Set(layout.panes));

  const openPanes = layout.panes.flatMap((id) => {
    const view = views.get(id);
    return view ? [view] : [];
  });
  const shown = !hidden && (openPanes.length > 0 || hasInfo);
  const { present, toggling } = useDockPresence(shown);
  // While it slides away the dock keeps showing what it held.
  const lastPanesRef = useRef(openPanes);
  if (shown) lastPanesRef.current = openPanes;
  const panes = shown ? openPanes : lastPanesRef.current;
  const shares = getDockPaneShares({ panes: panes.map((view) => view.id), sizes: layout.sizes });
  const maximized = panes.find((view) => view.id === layout.maximized) ?? null;

  if (!present) return null;

  const showsPanes = panes.length > 0;
  const sessionAttribute =
    owner.kind === "session" ? { [AGENT_SESSION_CHAT_ATTRIBUTE]: owner.id } : {};
  // While sliding, the content keeps its full width so terminals and pages do not reflow.
  const sliding = toggling && !maximized;

  return (
    <aside
      data-slot="workbench-dock"
      data-dock-owner={owner.kind}
      data-maximized={maximized ? "true" : undefined}
      data-state={shown ? "open" : "closed"}
      aria-label={owner.kind === "session" ? "Session tools" : "Project tools"}
      aria-hidden={shown ? undefined : true}
      inert={!shown}
      {...sessionAttribute}
      className={cn(
        // Beside a sidebar in a narrow window the dock shrinks, so the centre keeps its room.
        "relative flex h-full min-h-0 min-w-0",
        maximized && "flex-1",
        sliding && "shrink-0",
        !maximized && showsPanes && "w-(--dock-width) max-w-[calc(100%-22.5rem)]",
        !maximized && !showsPanes && "w-(--spacing-session-boxes)",
        sliding &&
          "overflow-hidden transition-[width] duration-fast ease-smooth starting:w-0 motion-reduce:transition-none",
        !shown && "w-0",
      )}
      style={{ "--dock-width": `${width}px` } as CSSProperties}
    >
      {showsPanes && !maximized && shown ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize dock"
          tabIndex={-1}
          onMouseDown={onMouseDown}
          onDoubleClick={() => actions.setWidth(MIN_DOCK_WIDTH + 120)}
          className="group absolute inset-y-0 left-0 z-30 flex w-workbench cursor-col-resize justify-center"
        >
          <div
            className={cn(
              "h-full w-px transition-colors duration-fast ease-smooth",
              dragging ? "bg-primary" : "group-hover:bg-border-strong",
            )}
          />
        </div>
      ) : null}
      {dragging ? <div className="fixed inset-0 z-40 cursor-col-resize" /> : null}
      <div
        data-slot="dock-content"
        className={cn(
          "flex h-full min-h-0 shrink-0 flex-col gap-workbench pl-workbench",
          sliding && showsPanes && "w-(--dock-width)",
          sliding && !showsPanes && "w-(--spacing-session-boxes)",
          !sliding && "w-full",
        )}
      >
        {hasInfo && !maximized ? <SessionInfo chatId={owner.id} compact={showsPanes} /> : null}
        {showsPanes ? (
          <div
            ref={stackRef}
            data-pane-split-container="true"
            className="flex min-h-0 flex-1 flex-col"
          >
            {(maximized ? [maximized] : panes).map((view, index) => (
              <Fragment key={view.id}>
                {index > 0 ? (
                  <PaneResizeHandle
                    direction="vertical"
                    appearance="gap"
                    initialSizes={[shares[index - 1], shares[index]]}
                    resizeHandleCount={panes.length - 1}
                    onReset={() =>
                      actions.resize(owner, { [panes[index - 1].id]: 1, [view.id]: 1 })
                    }
                    onResize={([before, after]) => {
                      // The handle previews the drag on the panes' inline flex-grow; the store
                      // owns their shares from here on.
                      for (const element of stackRef.current?.querySelectorAll<HTMLElement>(
                        "[data-dock-pane]",
                      ) ?? []) {
                        element.style.removeProperty("flex-grow");
                      }
                      actions.resize(
                        owner,
                        Object.fromEntries(
                          panes.map((pane, paneIndex) => [
                            pane.id,
                            paneIndex === index - 1
                              ? before
                              : paneIndex === index
                                ? after
                                : shares[paneIndex],
                          ]),
                        ),
                      );
                    }}
                  />
                ) : null}
                <DockPaneFrame
                  owner={owner}
                  view={view}
                  share={shares[panes.indexOf(view)] ?? 1}
                  maximized={view === maximized}
                  appear={!initialPanes.has(view.id)}
                  dockActions={index === 0 ? <DockAddPaneMenu owner={owner} /> : undefined}
                  windowTopRow={MERGED_TITLE_ROW && index === 0 && !(hasInfo && !maximized)}
                />
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/**
 * The right dock: the tools of the session (or project) in the centre, stacked as panes, with the
 * session's details above them. Each owner keeps its own layout.
 */
export function WorkbenchDock({ owner }: { owner: DockOwner | null }) {
  const { setCurrentOwner } = useDockLayoutStore.use.actions();
  useEffect(() => {
    setCurrentOwner(owner);
  }, [owner, setCurrentOwner]);
  if (!owner) return null;
  if (owner.kind === "session") return <SessionDock key={owner.id} chatId={owner.id} />;
  return <Dock key={owner.id} owner={owner} hasInfo={false} />;
}

/** Whether a pane of the owner's dock is maximized over the centre. */
export function useDockCoversCentre(owner: DockOwner | null): boolean {
  const layout = useDockLayout(owner);
  const hidden = useDockLayoutStore.use.hidden();
  return Boolean(owner && !hidden && layout.maximized && layout.panes.includes(layout.maximized));
}
