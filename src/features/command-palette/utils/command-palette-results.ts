import type { Action } from "../types/action.types";
import { matchesSearchQuery } from "@/utils/search-match";

export const commandPaletteFilters = [
  { id: "all", label: "All" },
  { id: "files", label: "Files" },
  { id: "navigation", label: "Navigation" },
  { id: "git", label: "Git" },
  { id: "github", label: "GitHub" },
  { id: "settings", label: "Settings" },
  { id: "extensions", label: "Extensions" },
] as const;

export type CommandPaletteFilter = (typeof commandPaletteFilters)[number]["id"];

const categoryFilters: Record<string, Exclude<CommandPaletteFilter, "all">> = {
  File: "files",
  Markdown: "files",
  Editor: "files",
  Language: "files",
  Navigation: "navigation",
  View: "navigation",
  Window: "navigation",
  Terminal: "navigation",
  Git: "git",
  GitHub: "github",
  Settings: "settings",
  Theme: "settings",
  Features: "settings",
  Extensions: "extensions",
  Database: "extensions",
  Generate: "extensions",
  AI: "extensions",
  Advanced: "extensions",
  CLI: "extensions",
  Developer: "extensions",
  LSP: "extensions",
  "Language Server": "extensions",
  Vim: "extensions",
};

export interface CommandPaletteSection {
  id: string;
  label: string;
  actions: Action[];
}

export function getCommandPaletteFilter(action: Action): Exclude<CommandPaletteFilter, "all"> {
  return categoryFilters[action.category] ?? "extensions";
}

export function getCommandPaletteSections({
  actions,
  filter,
  query,
  recentActionIds,
  showRecent,
}: {
  actions: Action[];
  filter: CommandPaletteFilter;
  query: string;
  recentActionIds: string[];
  showRecent: boolean;
}): CommandPaletteSection[] {
  const normalizedQuery = query.trim();
  const filteredActions = actions.filter((action) => {
    if (filter !== "all" && getCommandPaletteFilter(action) !== filter) return false;
    if (!normalizedQuery) return true;
    return matchesSearchQuery(normalizedQuery, [action.label, action.description, action.category]);
  });
  const actionsById = new Map(filteredActions.map((action) => [action.id, action]));
  const recentActions = showRecent
    ? recentActionIds
        .map((id) => actionsById.get(id))
        .filter((action): action is Action => Boolean(action))
    : [];
  const recentIds = new Set(recentActions.map((action) => action.id));
  const remainingActions = filteredActions.filter((action) => !recentIds.has(action.id));
  const prioritizedActions = [...recentActions, ...remainingActions];

  if (normalizedQuery) {
    return prioritizedActions.length
      ? [{ id: "results", label: "Results", actions: prioritizedActions }]
      : [];
  }

  if (filter !== "all") {
    const label = commandPaletteFilters.find((item) => item.id === filter)?.label ?? filter;
    return prioritizedActions.length ? [{ id: filter, label, actions: prioritizedActions }] : [];
  }

  if (!showRecent) {
    return filteredActions.length
      ? [{ id: "commands", label: "All commands", actions: filteredActions }]
      : [];
  }

  return [
    ...(recentActions.length ? [{ id: "recent", label: "Recent", actions: recentActions }] : []),
    ...(remainingActions.length
      ? [{ id: "commands", label: "All commands", actions: remainingActions }]
      : []),
  ];
}

export function flattenCommandPaletteSections(sections: CommandPaletteSection[]): Action[] {
  return sections.flatMap((section) => section.actions);
}
