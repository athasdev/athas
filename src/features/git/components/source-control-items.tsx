import type { ReactNode } from "react";
import type { GitSidebarItemId } from "@/features/layout/config/item-order";
import {
  ArchiveIcon,
  GitDiffIcon,
  HistoryIcon,
  ListChecksIcon,
  NodesIcon,
  TagIcon,
} from "@/ui/icons";

export const SOURCE_CONTROL_ITEM_LABELS: Record<GitSidebarItemId, string> = {
  changes: "Changes",
  history: "History",
  review: "Review",
  remotes: "Remotes",
  tags: "Tags",
  stashes: "Stashes",
};

export const SOURCE_CONTROL_ITEM_ICONS: Record<GitSidebarItemId, ReactNode> = {
  changes: <GitDiffIcon />,
  history: <HistoryIcon />,
  review: <ListChecksIcon />,
  remotes: <NodesIcon />,
  tags: <TagIcon />,
  stashes: <ArchiveIcon />,
};
