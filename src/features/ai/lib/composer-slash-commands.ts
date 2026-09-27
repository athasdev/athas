import type { SlashCommand } from "@/features/ai/types/acp.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import type {
  ComposerCommandAction,
  ComposerSlashCommand,
} from "@/features/ai/types/composer-slash-command.types";
import type { ComposerModeIntent } from "@/features/ai/types/composer-mode.types";

interface BuiltInCommand {
  name: string;
  description: string;
  action: ComposerCommandAction;
  /** Only the built-in agent keeps its history in Athas, so only it can clear or compact it. */
  builtInAgentOnly?: boolean;
}

const MODE_COMMANDS: { intent: ComposerModeIntent; name: string; description: string }[] = [
  { intent: "agent", name: "agent", description: "Switch to Agent mode: edit files and run tools" },
  { intent: "ask", name: "ask", description: "Switch to Ask mode: answer without changing files" },
  { intent: "plan", name: "plan", description: "Switch to Plan mode: propose a plan first" },
];

const BUILT_IN_COMMANDS: BuiltInCommand[] = [
  ...MODE_COMMANDS.map(({ intent, name, description }) => ({
    name,
    description,
    action: { type: "mode" as const, intent },
  })),
  {
    name: "compact",
    description: "Summarise earlier messages to free up context",
    action: { type: "compact" },
    builtInAgentOnly: true,
  },
  {
    name: "review",
    description: "Review the agent's changes hunk by hunk",
    action: { type: "review" },
  },
  { name: "new", description: "Start a new chat", action: { type: "new" } },
  {
    name: "clear",
    description: "Clear this chat's messages",
    action: { type: "clear" },
    builtInAgentOnly: true,
  },
];

/** A skill's title as a slash command name: "Write release notes" becomes "write-release-notes". */
export function toSkillCommandName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * One list for the "/" menu: the agent's own commands first, then Athas's commands, then the
 * user's skills. A name the agent already provides keeps the agent's version.
 */
export function mergeComposerSlashCommands({
  agentCommands,
  skills,
  isBuiltInAgent,
  availableModeIntents,
}: {
  agentCommands: SlashCommand[];
  skills: AIChatSkill[];
  isBuiltInAgent: boolean;
  availableModeIntents: ComposerModeIntent[];
}): ComposerSlashCommand[] {
  const taken = new Set<string>();
  const commands: ComposerSlashCommand[] = [];
  const add = (command: ComposerSlashCommand) => {
    const key = command.name.toLowerCase();
    if (!key || taken.has(key)) return;
    taken.add(key);
    commands.push(command);
  };

  for (const command of agentCommands) add({ ...command, source: "agent" });
  for (const command of BUILT_IN_COMMANDS) {
    if (command.builtInAgentOnly && !isBuiltInAgent) continue;
    if (command.action.type === "mode" && !availableModeIntents.includes(command.action.intent)) {
      continue;
    }
    add({
      name: command.name,
      description: command.description,
      source: "built-in",
      action: command.action,
    });
  }
  for (const skill of skills) {
    add({
      name: toSkillCommandName(skill.title),
      description: skill.description || `Skill: ${skill.title}`,
      source: "skill",
      action: { type: "skill", skillId: skill.id },
    });
  }
  return commands;
}

export function filterComposerSlashCommands<T extends SlashCommand>(
  commands: T[],
  search: string,
): T[] {
  const query = search.trim().toLowerCase();
  if (!query) return commands;
  const matches = commands.filter(
    (command) =>
      command.name.toLowerCase().includes(query) ||
      command.description?.toLowerCase().includes(query),
  );
  // Names that start with the query come first, so "/c" offers /compact before /review.
  return [
    ...matches.filter((command) => command.name.toLowerCase().startsWith(query)),
    ...matches.filter((command) => !command.name.toLowerCase().startsWith(query)),
  ];
}

/**
 * A message that starts with an Athas mode command, such as "/plan add dark mode": the mode to
 * switch to and the prompt to send in it.
 */
export function parseLeadingModeCommand(
  text: string,
  commands: ComposerSlashCommand[],
): { intent: ComposerModeIntent; prompt: string } | null {
  const match = text.trimStart().match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const command = commands.find(
    (candidate) => candidate.name.toLowerCase() === match[1].toLowerCase(),
  );
  if (command?.action?.type !== "mode") return null;
  return { intent: command.action.intent, prompt: (match[2] ?? "").trim() };
}
