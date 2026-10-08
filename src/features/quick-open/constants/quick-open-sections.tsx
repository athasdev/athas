import type { ReactNode } from "react";
import {
  CodeIcon,
  FilesIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  SparkleIcon,
  StackIcon,
  TextAlignLeftIcon,
} from "@/ui/icons";
import type { QuickOpenSectionId } from "../types/quick-open.types";

export interface QuickOpenSectionDefinition {
  id: QuickOpenSectionId;
  label: string;
  icon: ReactNode;
  /** Typing one of these first in Files jumps to the section, like VS Code's quick open. */
  prefixes?: readonly string[];
  placeholder: string;
}

export const QUICK_OPEN_SECTIONS: readonly QuickOpenSectionDefinition[] = [
  { id: "files", label: "Files", icon: <FilesIcon />, placeholder: "Search files by name..." },
  {
    id: "text",
    label: "Text",
    icon: <TextAlignLeftIcon />,
    prefixes: ["%"],
    placeholder: "Search text in files...",
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: <CodeIcon />,
    prefixes: ["@", "#"],
    placeholder: "Search symbols in this file and the project...",
  },
  {
    id: "git",
    label: "Git",
    icon: <GitBranchIcon />,
    placeholder: "Search changes, branches and commits...",
  },
  {
    id: "github",
    label: "GitHub",
    icon: <GitPullRequestIcon />,
    placeholder: "Search pull requests and issues...",
  },
  {
    id: "agents",
    label: "Agents",
    icon: <SparkleIcon />,
    placeholder: "Search agent chats, or start one...",
  },
  { id: "tabs", label: "Tabs", icon: <StackIcon />, placeholder: "Switch to an open tab..." },
];

export function getQuickOpenSection(id: QuickOpenSectionId): QuickOpenSectionDefinition {
  return QUICK_OPEN_SECTIONS.find((section) => section.id === id) ?? QUICK_OPEN_SECTIONS[0]!;
}

/** The section a typed prefix leads to, with the query that follows it. */
export function matchQuickOpenPrefix(
  value: string,
): { section: QuickOpenSectionId; query: string } | null {
  for (const section of QUICK_OPEN_SECTIONS) {
    const prefix = section.prefixes?.find((candidate) => value.startsWith(candidate));
    if (prefix) {
      return { section: section.id, query: value.slice(prefix.length).trimStart() };
    }
  }
  return null;
}
