/** The three modes every chat offers, whatever the agent calls them. */
export type ComposerModeIntent = "agent" | "ask" | "plan";

export interface ComposerModeOption {
  id: string;
  label: string;
  intent?: ComposerModeIntent;
}

export interface ChatModeSource {
  kind: "built-in" | "codex" | "acp-mode" | "acp-config";
  options: ComposerModeOption[];
  currentId: string | null;
  sessionId?: string | null;
  configOptionId?: string;
}
