import { Button } from "@/ui/button";
import { Empty } from "@/ui/empty";
import { WindowExpandIcon } from "@/ui/icons";
import { focusAgentWindow } from "./agent-window-service";
import { useAgentWindowStore } from "./agent-window.store";

export function AgentWindowPlaceholder({ chatId }: { chatId: string }) {
  const status = useAgentWindowStore((state) => state.sessions[chatId]);
  return (
    <Empty>
      <Button
        variant="ghost"
        iconOnly
        tooltip="Show agent window"
        aria-label="Show agent window"
        onClick={() => focusAgentWindow(chatId)}
        disabled={status === "opening"}
      >
        <WindowExpandIcon />
      </Button>
    </Empty>
  );
}
