import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { getAgentCli } from "./agent-clis";

/** Opens an agent's own CLI in an Athas terminal. Only explicit user actions call this. */
export function openAgentCliInTerminal(agentId: AgentType): string | null {
  const cli = getAgentCli(agentId);
  if (!cli) return null;

  return useBufferStore.getState().actions.openTerminalBuffer({
    name: cli.name,
    command: cli.command,
    workingDirectory: useProjectStore.getState().rootFolderPath || undefined,
  });
}
