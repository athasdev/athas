import type { ReactNode } from "react";
import {
  CodeIcon,
  FilesIcon,
  HashIcon,
  SettingsIcon,
  StackIcon,
  TerminalIcon,
  TextAlignLeftIcon,
} from "@/ui/icons";
import type { QuickOpenSectionId } from "../types/quick-open.types";

export interface QuickOpenSectionDefinition {
  id: QuickOpenSectionId;
  label: string;
  icon: ReactNode;
  /** Typing this first in the Files section jumps to the section, like VS Code's quick open. */
  prefix?: string;
  placeholder: string;
}

export const QUICK_OPEN_SECTIONS: readonly QuickOpenSectionDefinition[] = [
  { id: "files", label: "Files", icon: <FilesIcon />, placeholder: "Search files by name..." },
  {
    id: "text",
    label: "Text",
    icon: <TextAlignLeftIcon />,
    prefix: "%",
    placeholder: "Search text in files...",
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: <CodeIcon />,
    prefix: "@",
    placeholder: "Go to a symbol in this file...",
  },
  {
    id: "workspace-symbols",
    label: "Workspace",
    icon: <HashIcon />,
    prefix: "#",
    placeholder: "Search symbols across the project...",
  },
  {
    id: "commands",
    label: "Commands",
    icon: <TerminalIcon />,
    prefix: ">",
    placeholder: "Run a command...",
  },
  { id: "tabs", label: "Tabs", icon: <StackIcon />, placeholder: "Switch to an open tab..." },
  {
    id: "settings",
    label: "Settings",
    icon: <SettingsIcon />,
    placeholder: "Search settings...",
  },
];

export function getQuickOpenSection(id: QuickOpenSectionId): QuickOpenSectionDefinition {
  return QUICK_OPEN_SECTIONS.find((section) => section.id === id) ?? QUICK_OPEN_SECTIONS[0]!;
}

/** The section a typed prefix leads to, with the query that follows it. */
export function matchQuickOpenPrefix(
  value: string,
): { section: QuickOpenSectionId; query: string } | null {
  for (const section of QUICK_OPEN_SECTIONS) {
    if (section.prefix && value.startsWith(section.prefix)) {
      return { section: section.id, query: value.slice(section.prefix.length).trimStart() };
    }
  }
  return null;
}
