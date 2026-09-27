import type { SlashCommand } from "@/features/ai/types/acp.types";
import type { ComposerModeIntent } from "@/features/ai/types/composer-mode.types";

/** What an Athas slash command does when chosen; agent commands are sent to the agent instead. */
export type ComposerCommandAction =
  | { type: "mode"; intent: ComposerModeIntent }
  | { type: "compact" }
  | { type: "review" }
  | { type: "new" }
  | { type: "clear" }
  | { type: "skill"; skillId: string };

export interface ComposerSlashCommand extends SlashCommand {
  source: "agent" | "built-in" | "skill";
  action?: ComposerCommandAction;
}
