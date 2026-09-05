import type { ReactNode } from "react";
import type { GitSidebarItemId } from "@/features/layout/config/item-order";
import {
  ArchiveIcon,
  ClockCounterClockwiseIcon,
  GitDiffIcon,
  ListChecksIcon,
  NetworkIcon,
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
  history: <ClockCounterClockwiseIcon />,
  review: <ListChecksIcon />,
  remotes: <NetworkIcon />,
  tags: <TagIcon />,
  stashes: <ArchiveIcon />,
};
