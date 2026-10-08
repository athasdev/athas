import type {
  Command,
  CommandContext,
  CommandPaletteClose,
  CommandPaletteEntry,
} from "@/features/keymaps/types/keymaps.types";
import { executeCommandWithFeedback } from "@/features/keymaps/services/execute-command-with-feedback";
import type {
  CommandPaletteProviderId,
  CommandPaletteSlot,
} from "../constants/command-palette-order";
import type { CommandPaletteItem } from "../types/command-palette-item.types";

/** The palette presentation of a command right now, or null when the palette should not offer it. */
export function resolveCommandPaletteEntry(
  command: Command,
  context: CommandContext,
): CommandPaletteEntry | null {
  if (!command.palette) return null;
  if (command.when && !command.when(context)) return null;
  if (command.palette === true) return {};
  return typeof command.palette === "function" ? command.palette(context) : command.palette;
}

export async function runCommandFromPalette(
  commandId: string,
  closeMode: CommandPaletteClose,
  closePalette: () => void,
): Promise<void> {
  if (closeMode === "before") closePalette();
  await executeCommandWithFeedback(commandId);
  if (closeMode === "settled") closePalette();
}

export function createCommandPaletteItem(
  command: Command,
  entry: CommandPaletteEntry,
): CommandPaletteItem {
  const closeMode = entry.closePalette ?? "before";

  return {
    id: command.id,
    label: entry.label ?? command.title,
    description: entry.description ?? command.description ?? "",
    icon: entry.icon ?? command.icon,
    category: entry.category ?? command.category ?? "Integrations",
    keybindingCommandId: entry.keybindingCommandId ?? command.id,
    run: (closePalette) => runCommandFromPalette(command.id, closeMode, closePalette),
  };
}

export type CommandPaletteProviders = Record<CommandPaletteProviderId, () => CommandPaletteItem[]>;

/**
 * Lists the palette rows in `order`: registered commands that declare `palette` and pass their
 * `when` predicate, with provider rows spliced in at their slots. Palette commands the order does
 * not mention follow at the end.
 */
export function buildCommandPaletteItems({
  commands,
  context,
  order,
  providers,
}: {
  commands: Command[];
  context: CommandContext;
  order: CommandPaletteSlot[];
  providers: CommandPaletteProviders;
}): CommandPaletteItem[] {
  const commandsById = new Map(commands.map((command) => [command.id, command]));
  const orderedIds = new Set<string>();
  const items: CommandPaletteItem[] = [];

  const addCommand = (command: Command | undefined) => {
    if (!command) return;
    const entry = resolveCommandPaletteEntry(command, context);
    if (entry) items.push(createCommandPaletteItem(command, entry));
  };

  for (const slot of order) {
    if (typeof slot === "string") {
      orderedIds.add(slot);
      addCommand(commandsById.get(slot));
    } else {
      items.push(...providers[slot.provider]());
    }
  }

  for (const command of commands) {
    if (!orderedIds.has(command.id)) addCommand(command);
  }

  return items;
}
