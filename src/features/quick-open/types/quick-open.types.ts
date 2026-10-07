import type { ReactNode } from "react";

export type QuickOpenSectionId =
  | "files"
  | "text"
  | "symbols"
  | "workspace-symbols"
  | "commands"
  | "tabs"
  | "settings";

/** One result row, whatever the section: rendered the same way and opened with `select`. */
export interface QuickOpenItem {
  key: string;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  accessory?: ReactNode;
  select: () => void;
}

export interface QuickOpenSectionResult {
  items: QuickOpenItem[];
  isLoading: boolean;
  /** A short count or status for the header badge, such as "12 results". */
  summary?: string;
  /** What to show when there are no items. */
  empty: ReactNode;
}

/** What every section hook receives: the query without its prefix and whether it is shown. */
export interface QuickOpenSectionInput {
  query: string;
  isActive: boolean;
  close: () => void;
}
