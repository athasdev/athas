import { PuzzlePieceIcon, SettingsIcon } from "@/ui/icons";
import type { RegisteredCommand } from "@/extensions/ui/types/ui-extension";
import { settingsTabLabels } from "@/features/settings/config/settings-tabs";
import { showToast } from "@/utils/toast";
import { settingsSearchIndex } from "@/features/settings/config/search-index";
import { useSettingsSearchStore } from "@/features/settings/stores/settings-search.store";
import type { VimCommand } from "@/features/vim/services/vim-commands";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { scoreSearchQuery } from "@/utils/search-match";
import type { CommandPaletteItem } from "../types/command-palette-item.types";

function getMatchingSettingsRecords(query: string) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) return [];

  return settingsSearchIndex
    .filter((record) => record.id !== "editor-vim-mode")
    .map((record) => {
      const score = scoreSearchQuery(trimmedQuery, [
        { value: record.label, weight: 11 },
        { value: record.description, weight: 1 },
        { value: record.section, weight: 1 },
        ...(record.keywords || []).map((keyword) => ({ value: keyword, weight: 6 })),
      ]);

      if (score === 0) return null;

      return { record, score };
    })
    .filter((entry): entry is { record: (typeof settingsSearchIndex)[number]; score: number } => {
      return entry !== null;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map((entry) => entry.record);
}

/** Individual settings that match the palette query, opened in the Settings page. */
export function createSettingsSearchItems(query: string): CommandPaletteItem[] {
  return getMatchingSettingsRecords(query).map((record) => ({
    id: `open-setting-${record.id}`,
    label: `Settings: ${record.label}`,
    description: `Open ${settingsTabLabels[record.tab]} > ${record.label}`,
    icon: <SettingsIcon />,
    category: "Settings",
    run: (closePalette) => {
      closePalette();
      useSettingsSearchStore.getState().actions.setQuery(record.label);
      useUIState.getState().openSettings(record.tab);
    },
  }));
}

/** Commands that installed integrations registered through the extension host. */
export function createExtensionCommandItems(
  commands: Iterable<RegisteredCommand>,
): CommandPaletteItem[] {
  return Array.from(commands, (command) => ({
    id: `extension-command:${command.id}`,
    label: command.title,
    description: command.category
      ? `${command.category} integration command`
      : "Installed integration command",
    icon: <PuzzlePieceIcon />,
    category: command.category ?? "Integrations",
    run: (closePalette) => {
      closePalette();
      void Promise.resolve(command.execute()).catch((error) => {
        showToast({
          message: error instanceof Error ? error.message : "Integration command failed",
          type: "error",
        });
      });
    },
  }));
}

/** Vim ex commands, offered while Vim mode is on. */
export function createVimCommandItems(
  vimMode: boolean,
  vimCommands: VimCommand[],
): CommandPaletteItem[] {
  if (!vimMode) return [];

  return vimCommands.map((command) => ({
    id: `vim-${command.name}`,
    label: `Vim: ${command.name}`,
    description: command.description,
    icon: undefined,
    category: "Vim",
    run: (closePalette) => {
      void command.execute();
      closePalette();
    },
  }));
}
