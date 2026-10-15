import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { Button } from "@/ui/button";
import { PlusIcon } from "@/ui/icons";

export function NewTabButton({ paneId }: { paneId: string }) {
  const { setActivePane } = usePaneStore.use.actions();

  return (
    <Button
      variant="ghost"
      iconOnly
      size="sm"
      tooltip="New tab"
      aria-label="New tab"
      onClick={() => {
        setActivePane(paneId);
        void keymapRegistry.executeCommand("workbench.agentLauncher");
      }}
    >
      <PlusIcon optical="md" />
    </Button>
  );
}
