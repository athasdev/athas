import type { GitDiffLine } from "../types/git.types";

export type DiffLineVisualType = "added" | "removed" | "context";

export interface DiffLineVisualState {
  lineBackground: string;
  gutterBackground: string;
  railClassName: string;
  gutterTextColor: string;
  contentColor: string;
  inlineBackground: string;
  inlineAccent: string;
  inlineHighlightBackground: string;
}

const primaryBackground = "var(--background)";
const gitAdded = "var(--git-added)";
const gitDeleted = "var(--git-deleted)";
const border = "var(--border)";

const DIFF_LINE_VISUALS: Record<DiffLineVisualType, DiffLineVisualState> = {
  added: {
    lineBackground: "bg-git-added/14",
    gutterBackground: "bg-git-added/18",
    railClassName: "shadow-[inset_2px_0_0_var(--git-added)]",
    gutterTextColor: "text-git-added",
    contentColor: "text-foreground",
    inlineBackground: `color-mix(in srgb, ${gitAdded} 16%, ${primaryBackground})`,
    inlineAccent: gitAdded,
    inlineHighlightBackground: `color-mix(in srgb, ${gitAdded} 36%, transparent)`,
  },
  removed: {
    lineBackground: "bg-git-deleted/14",
    gutterBackground: "bg-git-deleted/18",
    railClassName: "shadow-[inset_2px_0_0_var(--git-deleted)]",
    gutterTextColor: "text-git-deleted",
    contentColor: "text-foreground",
    inlineBackground: `color-mix(in srgb, ${gitDeleted} 16%, ${primaryBackground})`,
    inlineAccent: gitDeleted,
    inlineHighlightBackground: `color-mix(in srgb, ${gitDeleted} 36%, transparent)`,
  },
  context: {
    lineBackground: "",
    gutterBackground: "bg-background",
    railClassName: "",
    gutterTextColor: "text-subtle-foreground",
    contentColor: "text-foreground",
    inlineBackground: primaryBackground,
    inlineAccent: border,
    inlineHighlightBackground: "transparent",
  },
};

export function getDiffLineVisualType(lineType: GitDiffLine["line_type"]): DiffLineVisualType {
  if (lineType === "added" || lineType === "removed") {
    return lineType;
  }

  return "context";
}

export function getDiffLineVisualState(
  lineType: GitDiffLine["line_type"] | DiffLineVisualType,
): DiffLineVisualState {
  return DIFF_LINE_VISUALS[getDiffLineVisualType(lineType as GitDiffLine["line_type"])];
}
