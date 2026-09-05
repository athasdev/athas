// Shared types for AI chat utilities

import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { MentionedFile } from "@/features/ai/lib/file-mentions";
import type { ImageContent } from "./ai-chat.types";

export interface EditorSelectionContext {
  id: string;
  bufferId: string;
  filePath: string;
  fileName: string;
  languageId: string;
  selectedText: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface ContextInfo {
  images?: ImageContent[];
  activeBuffer?: PaneContent;
  openBuffers?: PaneContent[];
  selectedFiles?: string[];
  selectedProjectFiles?: string[];
  mentionedFiles?: MentionedFile[];
  editorSelections?: EditorSelectionContext[];
  projectRoot?: string;
  language?: string;
  providerId?: string;
  agentId?: string;
}
