import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { getPaneView, renderPaneView } from "@/features/panes/services/pane-view-registry";

/** A buffer's view outside the workbench, where it has no pane. */
export function DetachedBufferView({ buffer }: { buffer: PaneContent }) {
  return renderPaneView(buffer, {});
}

export function ResourceBufferIcon({ buffer }: { buffer: PaneContent }) {
  const Icon = getPaneView(buffer.type)?.resource?.icon;
  return Icon ? <Icon buffer={buffer} /> : null;
}

/** Live status of the resource, for chrome that sits outside the viewer. */
export function ResourceBufferBadge({ buffer }: { buffer: PaneContent }) {
  const Badge = getPaneView(buffer.type)?.resource?.badge;
  return Badge ? <Badge buffer={buffer} /> : null;
}
