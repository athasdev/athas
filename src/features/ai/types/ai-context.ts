// Shared types for AI chat utilities

import type { PaneContent } from "@/features/panes/types/pane-content";
import type { MentionedFile } from "@/features/ai/lib/file-mentions";

export interface ContextInfo {
  activeBuffer?: PaneContent & { webViewerContent?: string };
  openBuffers?: PaneContent[];
  selectedFiles?: string[];
  selectedProjectFiles?: string[];
  mentionedFiles?: MentionedFile[];
  projectRoot?: string;
  language?: string;
  providerId?: string;
  agentId?: string;
}
