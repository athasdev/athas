import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { getTerminalAgent } from "./terminal-agents";

export function openTerminalAgent(agentId: string): string | null {
  const agent = getTerminalAgent(agentId);
  if (!agent) return null;

  return useBufferStore.getState().actions.openTerminalBuffer({
    name: agent.name,
    command: agent.command,
    workingDirectory: useProjectStore.getState().rootFolderPath || undefined,
  });
}
