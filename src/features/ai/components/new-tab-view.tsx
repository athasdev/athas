import { AgentLaunchInput } from "./agent-launch-input";
import { AgentStartView } from "./agent-start-view";

/** A new tab: the agent start screen with its launch input. */
export function NewTabView({ surfaceId, autoFocus }: { surfaceId: string; autoFocus?: boolean }) {
  return (
    <AgentStartView showQuickActions>
      <AgentLaunchInput autoFocus={autoFocus} surfaceId={surfaceId} />
    </AgentStartView>
  );
}
