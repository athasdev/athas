// Shared types for AI chat utilities

import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { MentionedFile } from "@/features/ai/lib/file-mentions";
import type { ImageContent } from "./ai-chat.types";
import type { LoadedProjectRules } from "./project-rules.types";
import type { ResolvedContextReference } from "./context-references.types";
import type { EditorSelectionContext } from "@/features/editor/types/editor-selection.types";

export interface ContextInfo {
  images?: ImageContent[];
  activeBuffer?: PaneContent;
  openBuffers?: PaneContent[];
  selectedFiles?: string[];
  selectedProjectFiles?: string[];
  mentionedFiles?: MentionedFile[];
  /** Resolved @folder, Git diff, problems and past chat context. */
  contextReferences?: ResolvedContextReference[];
  editorSelections?: EditorSelectionContext[];
  projectRoot?: string;
  teamInstructions?: string;
  /** AGENTS.md, CLAUDE.md, rule folders and user rules loaded for the built-in agent. */
  projectRules?: LoadedProjectRules;
  language?: string;
  providerId?: string;
  agentId?: string;
}
