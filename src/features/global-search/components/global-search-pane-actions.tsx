import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { SquareArrowUpIcon } from "@/ui/icons";
import { SidebarIconButton } from "@/ui/sidebar";

/** The Search pane header's action: carry the search into a tab with room for the file list. */
export function GlobalSearchPaneActions() {
  return (
    <SidebarIconButton
      tooltip="Open search in a tab"
      aria-label="Open search in a tab"
      onClick={() => useBufferStore.getState().actions.openGlobalSearchBuffer()}
    >
      <SquareArrowUpIcon />
    </SidebarIconButton>
  );
}
