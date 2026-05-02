import { PaneNodeRenderer } from "@/features/panes/components/pane-node-renderer";
import { usePaneStore } from "@/features/panes/stores/pane-store";

export function BottomBufferPane() {
  const bottomRoot = usePaneStore.use.bottomRoot();

  return <PaneNodeRenderer node={bottomRoot} />;
}
