import {
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from "react";
import type { DockPaneProps } from "@/features/layout/services/dock-pane-registry";
import { getDockOwnerKey, useDockLayoutStore } from "@/features/layout/stores/dock-layout.store";
import type { DockOwner, DockPaneId } from "@/features/layout/types/dock.types";
import { Button } from "@/ui/button";
import { ArrowsInIcon, ArrowsOutIcon, XIcon } from "@/ui/icons";
import { Pane, PaneActions, PaneBody, PaneHeader, PaneTitle } from "@/ui/pane";

const DRAG_TYPE = "application/x-athas-dock-pane";

export interface DockPaneView {
  id: DockPaneId;
  title: string;
  icon: ReactNode;
  render: (props: DockPaneProps) => ReactNode;
  renderDetail?: (props: DockPaneProps) => ReactNode;
  renderActions?: (props: DockPaneProps) => ReactNode;
  /** The view brings its own title bar, whose actions move into this pane's header. */
  hostsViewChrome?: boolean;
}

interface DockPaneFrameProps {
  owner: DockOwner;
  view: DockPaneView;
  share: number;
  maximized: boolean;
}

/**
 * One tool in the dock: the shared pane header (its name, its own actions, maximize and close)
 * over the tool. Dragging a header onto another reorders them.
 */
export function DockPaneFrame({ owner, view, share, maximized }: DockPaneFrameProps) {
  const ownerKey = getDockOwnerKey(owner);
  const actions = useDockLayoutStore.use.actions();
  const focusNonce = useDockLayoutStore((state) =>
    state.focusRequest?.owner === ownerKey && state.focusRequest.pane === view.id
      ? state.focusRequest.nonce
      : null,
  );
  const [focusRequested, setFocusRequested] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  useEffect(() => {
    if (focusNonce === null) return;
    if (!actions.consumeFocus(owner, view.id)) return;
    setFocusRequested(true);
  }, [actions, focusNonce, owner, view.id]);

  const props: DockPaneProps = { owner, focusRequested };

  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData(DRAG_TYPE, view.id);
    event.dataTransfer.effectAllowed = "move";
  };
  const acceptsDrop = (event: DragEvent) => event.dataTransfer.types.includes(DRAG_TYPE);
  const onDrop = (event: DragEvent) => {
    setDropTarget(false);
    const dragged = event.dataTransfer.getData(DRAG_TYPE);
    if (!dragged || dragged === view.id) return;
    event.preventDefault();
    const panes = useDockLayoutStore.getState().layouts[ownerKey]?.panes ?? [];
    actions.move(owner, dragged, panes.indexOf(view.id));
  };

  return (
    <Pane
      surface="island"
      hostsViewChrome={view.hostsViewChrome}
      role="region"
      aria-label={view.title}
      data-dock-pane={view.id}
      data-maximized={maximized || undefined}
      className="min-h-24 grow-(--dock-pane-share) basis-0"
      style={{ "--dock-pane-share": maximized ? 1 : share } as CSSProperties}
    >
      <PaneHeader
        draggable={!maximized}
        onDragStart={onDragStart}
        onDragOver={(event) => {
          if (!acceptsDrop(event)) return;
          event.preventDefault();
          setDropTarget(true);
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={onDrop}
        dropTarget={dropTarget}
        onDoubleClick={(event) => {
          if ((event.target as Element).closest("button, input")) return;
          actions.toggleMaximized(owner, view.id);
        }}
      >
        <PaneTitle
          icon={view.icon}
          detail={
            view.renderDetail ? (
              <Suspense fallback={null}>{view.renderDetail(props)}</Suspense>
            ) : undefined
          }
        >
          {view.title}
        </PaneTitle>
        <PaneActions>
          {view.renderActions ? (
            <Suspense fallback={null}>{view.renderActions(props)}</Suspense>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            iconOnly
            active={maximized}
            aria-pressed={maximized}
            aria-label={maximized ? `Restore ${view.title}` : `Maximize ${view.title}`}
            tooltip={maximized ? "Restore" : "Maximize"}
            onClick={() => actions.toggleMaximized(owner, view.id)}
          >
            {maximized ? <ArrowsInIcon /> : <ArrowsOutIcon />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            aria-label={`Close ${view.title}`}
            tooltip="Close"
            onClick={() => actions.close(owner, view.id)}
          >
            <XIcon />
          </Button>
        </PaneActions>
      </PaneHeader>
      <PaneBody>
        <Suspense fallback={null}>{view.render(props)}</Suspense>
      </PaneBody>
    </Pane>
  );
}
