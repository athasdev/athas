import { Button } from "@/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { focusAgentWindow } from "./agent-window-service";
import { useAgentWindowStore } from "./agent-window.store";

export function AgentWindowPlaceholder() {
  const status = useAgentWindowStore.use.status();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          {status === "opening" ? "Opening Agents window…" : "Agents are detached"}
        </EmptyTitle>
        <EmptyDescription>
          Your sessions are in the Agents window. Close it to return them here.
        </EmptyDescription>
      </EmptyHeader>
      <Button onClick={() => focusAgentWindow()} disabled={status === "opening"}>
        Show Agents Window
      </Button>
    </Empty>
  );
}
