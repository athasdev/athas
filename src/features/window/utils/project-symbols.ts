import {
  BugIcon,
  CloudIcon,
  CodeIcon,
  CubeIcon,
  DatabaseIcon,
  FolderIcon,
  GearIcon,
  GlobeIcon,
  LightningIcon,
  MoonIcon,
  PaletteIcon,
  RocketLaunchIcon,
  ShieldIcon,
  SparkleIcon,
  StackIcon,
  SunIcon,
  TerminalIcon,
  WrenchIcon,
  type Icon,
} from "@/ui/icons";
import { defaultEmojiPickerOptions, emojiLabels } from "@/utils/emoji-catalog";

export type ProjectIconCategory = "files" | "emojis" | "icons";

export interface ProjectSymbol {
  value: string;
  name: string;
  keywords: string[];
  emoji?: string;
  icon?: Icon;
}

const projectIcons: Array<[string, string, Icon, string[]]> = [
  ["folder", "Folder", FolderIcon, ["files", "project"]],
  ["code", "Code", CodeIcon, ["development", "app"]],
  ["terminal", "Terminal", TerminalIcon, ["shell", "cli", "console"]],
  ["globe", "Globe", GlobeIcon, ["web", "website", "internet"]],
  ["database", "Database", DatabaseIcon, ["data", "sql", "storage"]],
  ["cloud", "Cloud", CloudIcon, ["server", "hosting", "deploy"]],
  ["cube", "Cube", CubeIcon, ["package", "module", "box"]],
  ["stack", "Stack", StackIcon, ["layers", "library"]],
  ["rocket", "Rocket", RocketLaunchIcon, ["launch", "release", "ship"]],
  ["lightning", "Lightning", LightningIcon, ["fast", "performance"]],
  ["bug", "Bug", BugIcon, ["debug", "issue", "test"]],
  ["shield", "Shield", ShieldIcon, ["security", "privacy"]],
  ["palette", "Palette", PaletteIcon, ["design", "color", "art"]],
  ["sparkle", "Sparkle", SparkleIcon, ["ai", "magic"]],
  ["gear", "Gear", GearIcon, ["settings", "config"]],
  ["wrench", "Wrench", WrenchIcon, ["tools", "build", "fix"]],
  ["sun", "Sun", SunIcon, ["light", "day"]],
  ["moon", "Moon", MoonIcon, ["dark", "night"]],
];

export const projectSymbols: Record<"emojis" | "icons", ProjectSymbol[]> = {
  emojis: defaultEmojiPickerOptions.map((emoji) => ({
    value: `emoji:${emoji}`,
    name: emojiLabels[emoji].label,
    keywords: emojiLabels[emoji].keywords,
    emoji,
  })),
  icons: projectIcons.map(([id, name, icon, keywords]) => ({
    value: `icon:${id}`,
    name,
    icon,
    keywords,
  })),
};

export function getProjectIconCategory(value?: string): ProjectIconCategory {
  if (value?.startsWith("emoji:")) return "emojis";
  if (value?.startsWith("icon:")) return "icons";
  return "files";
}

export function findProjectSymbol(value: string) {
  const category = getProjectIconCategory(value);
  return category === "files"
    ? undefined
    : projectSymbols[category].find((symbol) => symbol.value === value);
}

export function searchProjectSymbols(category: "emojis" | "icons", query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return projectSymbols[category].filter((symbol) => {
    const text = [symbol.name, symbol.emoji ?? "", ...symbol.keywords]
      .join(" ")
      .toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}
