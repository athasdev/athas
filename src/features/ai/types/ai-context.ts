// Shared types for AI chat utilities

import type { PaneContent } from "@/features/panes/types/pane-content";

export interface ContextInfo {
  activeBuffer?: PaneContent & { webViewerContent?: string };
  openBuffers?: PaneContent[];
  selectedFiles?: string[];
  selectedProjectFiles?: string[];
  projectRoot?: string;
  language?: string;
  providerId?: string;
  agentId?: string;
}
