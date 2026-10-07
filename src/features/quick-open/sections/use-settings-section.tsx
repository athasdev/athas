import { type ReactNode, useMemo } from "react";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { settingsSearchIndex } from "@/features/settings/config/search-index";
import {
  SETTINGS_SEARCH_TAB_LABELS,
  scoreSettingSearchRecord,
} from "@/features/settings/lib/settings-search";
import { useUIState } from "@/features/window/stores/ui-state.store";
import type { SettingsTab } from "@/features/window/stores/ui-state/types/ui-state.types";
import { CommandEmpty } from "@/ui/command";
import {
  BellIcon,
  BrainIcon,
  ShieldCheckIcon,
  CloudIcon,
  CodeIcon,
  FolderIcon,
  GearIcon,
  GitBranchIcon,
  KeyIcon,
  KeyboardIcon,
  PaletteIcon,
  PlugsConnectedIcon,
  SparkleIcon,
  TerminalIcon,
  TranslateIcon,
  UserCircleIcon,
  UsersIcon,
  WrenchIcon,
} from "@/ui/icons";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

const SETTINGS_RESULT_LIMIT = 60;

const SETTINGS_COUNT_BY_TAB = settingsSearchIndex.reduce((counts, record) => {
  counts.set(record.tab, (counts.get(record.tab) ?? 0) + 1);
  return counts;
}, new Map<SettingsTab, number>());

const TAB_ICONS: Record<SettingsTab, ReactNode> = {
  general: <GearIcon />,
  sharing: <CloudIcon />,
  notifications: <BellIcon />,
  account: <UserCircleIcon />,
  appearance: <PaletteIcon />,
  editor: <CodeIcon />,
  language: <TranslateIcon />,
  "file-explorer": <FolderIcon />,
  git: <GitBranchIcon />,
  terminal: <TerminalIcon />,
  keyboard: <KeyboardIcon />,
  ai: <SparkleIcon />,
  "ai-models": <KeyIcon />,
  "ai-completion": <SparkleIcon />,
  "ai-agents": <BrainIcon />,
  "ai-mcp": <PlugsConnectedIcon />,
  collaboration: <UsersIcon />,
  enterprise: <ShieldCheckIcon />,
  advanced: <WrenchIcon />,
};

function settingsCount(count: number) {
  return count === 0 ? undefined : `${count} ${count === 1 ? "setting" : "settings"}`;
}

/** Settings by name, opening the settings page at the matching section. */
export function useSettingsSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const items = useMemo((): QuickOpenItem[] => {
    if (!isActive) return [];
    const openSettings = (tab: SettingsTab, section?: string) => {
      close();
      useUIState.getState().openSettings(tab, section);
    };

    if (!query.trim()) {
      return (Object.keys(SETTINGS_SEARCH_TAB_LABELS) as SettingsTab[]).map((tab) => ({
        key: `tab:${tab}`,
        icon: TAB_ICONS[tab],
        title: SETTINGS_SEARCH_TAB_LABELS[tab],
        description: settingsCount(SETTINGS_COUNT_BY_TAB.get(tab) ?? 0),
        select: () => openSettings(tab),
      }));
    }

    return settingsSearchIndex
      .map((record) => ({ record, score: scoreSettingSearchRecord(query, record) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, SETTINGS_RESULT_LIMIT)
      .map(({ record }) => ({
        key: record.id,
        icon: TAB_ICONS[record.tab],
        title: <SearchMatchHighlight text={record.label} query={query} />,
        description: `${SETTINGS_SEARCH_TAB_LABELS[record.tab]} › ${record.section}`,
        select: () => openSettings(record.tab, record.section),
      }));
  }, [close, isActive, query]);

  return {
    items,
    isLoading: false,
    summary: query.trim() ? settingsCount(items.length) : undefined,
    empty: <CommandEmpty>No matching settings</CommandEmpty>,
  };
}
