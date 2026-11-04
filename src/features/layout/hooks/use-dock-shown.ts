import { getDockSessionInfo } from "../services/dock-pane-registry";
import { selectDockLayout, useDockLayoutStore } from "../stores/dock-layout.store";

const noSessionInfo = () => false;

/**
 * Whether the dock beside the centre is out, as `isDockShown` reads it; null in a window without
 * a dock, such as a detached one.
 */
export function useDockShown(): boolean | null {
  return useDockLayoutStore((state) => {
    const owner = state.currentOwner;
    if (!owner) return null;
    if (state.hidden) return false;
    return owner.kind === "session" || selectDockLayout(state, owner).panes.length > 0;
  });
}

/**
 * Whether the dock would show anything when out: the tools opened in it, or a session's details
 * once it has started.
 */
export function useDockHasContent(): boolean {
  const owner = useDockLayoutStore((state) => state.currentOwner);
  const hasPanes = useDockLayoutStore((state) =>
    owner ? selectDockLayout(state, owner).panes.length > 0 : false,
  );
  const useHasContent = getDockSessionInfo()?.useHasContent ?? noSessionInfo;
  const hasInfo = useHasContent(owner?.kind === "session" ? owner.id : "");
  return hasPanes || (owner?.kind === "session" && hasInfo);
}
