import { type ReactNode, useCallback, useMemo } from "react";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import Keybinding from "@/features/keymaps/components/keybinding";
import { useKeymapStore } from "@/features/keymaps/stores/keymaps.store";
import type { Command } from "@/features/keymaps/types/keymaps.types";
import { getEffectiveShortcutsByCommand } from "@/features/keymaps/utils/effective-keymaps";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { CommandEmpty, CommandItemBadge } from "@/ui/command";
import {
  BugIcon,
  CodeIcon,
  DatabaseIcon,
  FileIcon,
  GlobeIcon,
  MonitorIcon,
  NodesIcon,
  PenIcon,
  QuestionIcon,
  RowsIcon,
  SelectAllIcon,
  SidebarIcon,
  SparkleIcon,
  TerminalIcon,
  ArrowRightIcon,
} from "@/ui/icons";
import { scoreSearchQuery } from "@/utils/search-match";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

const CATEGORY_ICONS: Record<string, ReactNode> = {
  AI: <SparkleIcon />,
  Agent: <SparkleIcon />,
  Browser: <GlobeIcon />,
  Database: <DatabaseIcon />,
  Debug: <BugIcon />,
  Edit: <PenIcon />,
  File: <FileIcon />,
  Help: <QuestionIcon />,
  "Language Server": <NodesIcon />,
  Navigation: <ArrowRightIcon />,
  Selection: <SelectAllIcon />,
  Terminal: <TerminalIcon />,
  View: <SidebarIcon />,
  Window: <MonitorIcon />,
  Workbench: <RowsIcon />,
};

const FALLBACK_ICON = <CodeIcon />;

export function rankCommands(commands: readonly Command[], query: string): Command[] {
  if (!query.trim()) {
    return [...commands].sort(
      (a, b) =>
        (a.category ?? "").localeCompare(b.category ?? "") || a.title.localeCompare(b.title),
    );
  }
  return commands
    .map((command) => ({
      command,
      score: scoreSearchQuery(query, [
        { value: command.title, weight: 8 },
        { value: command.category ?? "", weight: 3 },
        { value: command.description ?? "", weight: 1 },
        { value: command.id, weight: 1 },
      ]),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title))
    .map(({ command }) => command);
}

/** Every registered command, with its current shortcut. */
export function useCommandsSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const userKeybindings = useKeymapStore.use.keybindings();
  const keybindingPreset = useSettingsStore((state) => state.settings.keybindingPreset);
  const shortcutsByCommand = useMemo(
    () =>
      isActive
        ? getEffectiveShortcutsByCommand({
            preset: keybindingPreset,
            registryKeybindings: keymapRegistry.getAllKeybindings(),
            userKeybindings,
          })
        : new Map<string, string>(),
    [isActive, keybindingPreset, userKeybindings],
  );
  // The registry is filled once at startup, so reading it when the section shows is enough.
  const commands = useMemo(() => (isActive ? keymapRegistry.getAllCommands() : []), [isActive]);

  const run = useCallback(
    (command: Command) => {
      close();
      // Let focus return to where it was before quick open, so the command acts on it.
      requestAnimationFrame(() => void keymapRegistry.executeCommand(command.id));
    },
    [close],
  );

  const items = useMemo(
    () =>
      rankCommands(commands, query).map((command): QuickOpenItem => {
        const binding = shortcutsByCommand.get(command.id);
        return {
          key: command.id,
          icon: command.icon ?? CATEGORY_ICONS[command.category ?? ""] ?? FALLBACK_ICON,
          title: <SearchMatchHighlight text={command.title} query={query} />,
          description: command.description,
          accessory: (
            <>
              {command.category ? <CommandItemBadge>{command.category}</CommandItemBadge> : null}
              {binding ? <Keybinding binding={binding} /> : null}
            </>
          ),
          select: () => run(command),
        };
      }),
    [commands, query, run, shortcutsByCommand],
  );

  return {
    items,
    isLoading: false,
    summary: `${items.length} ${items.length === 1 ? "command" : "commands"}`,
    empty: <CommandEmpty>No matching commands</CommandEmpty>,
  };
}
