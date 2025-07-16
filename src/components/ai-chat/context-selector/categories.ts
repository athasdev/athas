import {
  AlertTriangle,
  BookOpen,
  FileText,
  GitBranch,
  Globe,
  Shield,
  Terminal,
} from "lucide-react";
import type { ContextCategory } from "./types";

export const CONTEXT_CATEGORIES: ContextCategory[] = [
  {
    id: "files",
    name: "Files",
    description: "Project files and documents",
    icon: FileText,
    shortcut: "Ctrl+F",
  },
  {
    id: "docs",
    name: "Docs",
    description: "Documentation and README files",
    icon: BookOpen,
    shortcut: "Ctrl+D",
  },
  {
    id: "rules",
    name: "Rules",
    description: "ESLint, Prettier, and other config files",
    icon: Shield,
    shortcut: "Ctrl+R",
  },
  {
    id: "web",
    name: "Web",
    description: "URLs and web resources",
    icon: Globe,
    shortcut: "Ctrl+W",
  },
  {
    id: "terminals",
    name: "Terminals",
    description: "Terminal sessions and output",
    icon: Terminal,
    shortcut: "Ctrl+T",
  },
  {
    id: "git",
    name: "Git",
    description: "Git history and diffs",
    icon: GitBranch,
    shortcut: "Ctrl+G",
  },
  {
    id: "errors",
    name: "Errors",
    description: "Error logs and diagnostics",
    icon: AlertTriangle,
    shortcut: "Ctrl+E",
  },
];

export const getCategoryById = (id: string): ContextCategory | undefined => {
  return CONTEXT_CATEGORIES.find(category => category.id === id);
};

export const getCategoryByShortcut = (shortcut: string): ContextCategory | undefined => {
  return CONTEXT_CATEGORIES.find(
    category => category.shortcut?.toLowerCase() === shortcut.toLowerCase(),
  );
};
