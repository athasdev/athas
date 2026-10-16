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
import { cn } from "@/utils/cn";
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
  if (!compact) return <Column chatId={chatId} />;
  return (
    <div
      data-slot="dock-session-info"
      data-expanded={layout.infoExpanded || undefined}
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col"
    >
      <Summary
        chatId={chatId}
        expanded={layout.infoExpanded}
        onToggle={() => setInfoExpanded(owner, !layout.infoExpanded)}
      />
      {layout.infoExpanded ? <Column chatId={chatId} /> : null}
    </div>
  );
}

const noSessionInfo = () => false;

function SessionDock({ chatId }: { chatId: string }) {
  const useHasContent = getDockSessionInfo()?.useHasContent ?? noSessionInfo;
  const hasInfo = useHasContent(chatId);
  return <Dock owner={{ kind: "session", id: chatId }} hasInfo={hasInfo} />;
}

function Dock({ owner, hasInfo }: { owner: DockOwner; hasInfo: boolean }) {
  const layout = useDockLayout(owner);
  const hidden = useDockLayoutStore.use.hidden();
  const width = useDockLayoutStore.use.width();
  const actions = useDockLayoutStore.use.actions();
  const views = useDockPaneViews(owner);
  const { dragging, onMouseDown } = useDockWidthDrag();
  const stackRef = useRef<HTMLDivElement>(null);

  const panes = layout.panes.flatMap((id) => {
    const view = views.get(id);
    return view ? [view] : [];
  });
  const shares = getDockPaneShares({ panes: panes.map((view) => view.id), sizes: layout.sizes });
  const maximized = panes.find((view) => view.id === layout.maximized) ?? null;

  if (hidden || (panes.length === 0 && !hasInfo)) return null;

  const showsPanes = panes.length > 0;
  const sessionAttribute =
    owner.kind === "session" ? { [AGENT_SESSION_CHAT_ATTRIBUTE]: owner.id } : {};

  return (
    <aside
      data-slot="workbench-dock"
      data-dock-owner={owner.kind}
      data-maximized={maximized ? "true" : undefined}
      aria-label={owner.kind === "session" ? "Session tools" : "Project tools"}
      {...sessionAttribute}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 shrink-0 flex-col gap-workbench pl-workbench",
        maximized
          ? "flex-1"
          : showsPanes
            ? "w-(--dock-width) max-w-[calc(100%-22.5rem)]"
            : "w-(--spacing-session-boxes)",
      )}
      style={{ "--dock-width": `${width}px` } as CSSProperties}
    >
      {showsPanes && !maximized ? (
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
              "h-full w-px transition-colors duration-fast ease-smooth group-hover:bg-primary",
              dragging && "bg-primary",
            )}
          />
        </div>
      ) : null}
      {dragging ? <div className="fixed inset-0 z-40 cursor-col-resize" /> : null}
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
                  onReset={() => actions.resize(owner, { [panes[index - 1].id]: 1, [view.id]: 1 })}
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
              />
            </Fragment>
          ))}
        </div>
      ) : null}
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
