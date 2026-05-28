import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useProjectStore } from "@/features/window/stores/project-store";
import { CLAUDE_CODE_TERMINAL_COMMAND } from "./claude-code";

export function openClaudeCodeTerminal(): string {
  return useBufferStore.getState().actions.openTerminalBuffer({
    name: "Claude Code",
    command: CLAUDE_CODE_TERMINAL_COMMAND,
    workingDirectory: useProjectStore.getState().rootFolderPath || undefined,
  });
}
