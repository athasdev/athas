import { openTerminalWindow } from "@/features/window/detached/standalone-content-service";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { FilePlusIcon, PlusIcon, SparkleIcon, TerminalWindowIcon } from "@/ui/icons";

export function NewTabMenu({ paneId }: { paneId: string }) {
  const { setActivePane } = usePaneStore.use.actions();
  const { openBuffer, openTerminalBuffer } = useBufferStore.use.actions();
  const terminalEnabled = useSettingsStore((state) => state.settings.coreFeatures.terminal);
  const openAgent = useNewAgentAction();

  const createInPane = (action: () => void) => {
    setActivePane(paneId);
    action();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" iconOnly tooltip="New tab" aria-label="New tab" />}
      >
        <PlusIcon optical="md" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() =>
            createInPane(() => {
              openBuffer(
                `untitled-${crypto.randomUUID()}`,
                "Untitled",
                "",
                false,
                undefined,
                false,
                true,
              );
            })
          }
        >
          <FilePlusIcon />
          New File
        </DropdownMenuItem>
        {terminalEnabled && (
          <DropdownMenuItem onClick={() => createInPane(openTerminalBuffer)}>
            <TerminalWindowIcon />
            New Terminal
          </DropdownMenuItem>
        )}
        {terminalEnabled && (
          <DropdownMenuItem onClick={() => void openTerminalWindow()}>
            <TerminalWindowIcon />
            New Terminal Window
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => createInPane(openAgent)}>
          <SparkleIcon />
          New Agent
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
