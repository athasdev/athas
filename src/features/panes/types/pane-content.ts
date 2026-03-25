import type { DatabaseType } from "@/features/database/models/provider.types";
import type { MultiFileDiff } from "@/features/git/types/git-diff-types";
import type { GitDiff } from "@/features/git/types/git-types";

// ── Token entry for syntax highlighting cache ───────────────────────

export interface TokenEntry {
  start: number;
  end: number;
  token_type: string;
  class_name: string;
}

// ── Content type discriminant ───────────────────────────────────────

export type PaneContentType =
  | "editor"
  | "terminal"
  | "agent"
  | "webViewer"
  | "newTab"
  | "diff"
  | "image"
  | "pdf"
  | "binary"
  | "database"
  | "pullRequest"
  | "markdownPreview"
  | "htmlPreview"
  | "csvPreview"
  | "externalEditor";

// ── Base fields shared by every content type ────────────────────────

interface PaneContentBase {
  id: string;
  type: PaneContentType;
  path: string;
  name: string;
  isPinned: boolean;
  isPreview: boolean;
  isActive: boolean;
}

// ── Per-type content definitions ────────────────────────────────────

export interface EditorContent extends PaneContentBase {
  type: "editor";
  content: string;
  savedContent: string;
  isDirty: boolean;
  isVirtual: boolean;
  language?: string;
  languageOverride?: string;
  tokens: TokenEntry[];
}

export interface TerminalContent extends PaneContentBase {
  type: "terminal";
  sessionId: string;
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
}

export interface AgentContent extends PaneContentBase {
  type: "agent";
  sessionId: string;
}

export interface WebViewerContent extends PaneContentBase {
  type: "webViewer";
  url: string;
  title?: string;
  favicon?: string;
}

export interface NewTabContent extends PaneContentBase {
  type: "newTab";
}

export interface DiffContent extends PaneContentBase {
  type: "diff";
  content: string;
  savedContent: string;
  diffData?: GitDiff | MultiFileDiff;
}

export interface ImageContent extends PaneContentBase {
  type: "image";
}

export interface PdfContent extends PaneContentBase {
  type: "pdf";
}

export interface BinaryContent extends PaneContentBase {
  type: "binary";
}

export interface DatabaseContent extends PaneContentBase {
  type: "database";
  databaseType: DatabaseType;
  connectionId?: string;
}

export interface PullRequestContent extends PaneContentBase {
  type: "pullRequest";
  prNumber: number;
}

export interface MarkdownPreviewContent extends PaneContentBase {
  type: "markdownPreview";
  content: string;
  sourceFilePath: string;
}

export interface HtmlPreviewContent extends PaneContentBase {
  type: "htmlPreview";
  content: string;
  sourceFilePath: string;
}

export interface CsvPreviewContent extends PaneContentBase {
  type: "csvPreview";
  content: string;
  sourceFilePath: string;
}

export interface ExternalEditorContent extends PaneContentBase {
  type: "externalEditor";
  terminalConnectionId: string;
}

// ── Discriminated union ─────────────────────────────────────────────

export type PaneContent =
  | EditorContent
  | TerminalContent
  | AgentContent
  | WebViewerContent
  | NewTabContent
  | DiffContent
  | ImageContent
  | PdfContent
  | BinaryContent
  | DatabaseContent
  | PullRequestContent
  | MarkdownPreviewContent
  | HtmlPreviewContent
  | CsvPreviewContent
  | ExternalEditorContent;

// ── Type guards ─────────────────────────────────────────────────────

export function isEditorContent(c: PaneContent): c is EditorContent {
  return c.type === "editor";
}

export function isTerminalContent(c: PaneContent): c is TerminalContent {
  return c.type === "terminal";
}

export function isAgentContent(c: PaneContent): c is AgentContent {
  return c.type === "agent";
}

export function isWebViewerContent(c: PaneContent): c is WebViewerContent {
  return c.type === "webViewer";
}

export function isNewTabContent(c: PaneContent): c is NewTabContent {
  return c.type === "newTab";
}

export function isDiffContent(c: PaneContent): c is DiffContent {
  return c.type === "diff";
}

export function isDatabaseContent(c: PaneContent): c is DatabaseContent {
  return c.type === "database";
}

export function isPullRequestContent(c: PaneContent): c is PullRequestContent {
  return c.type === "pullRequest";
}

export function isExternalEditorContent(c: PaneContent): c is ExternalEditorContent {
  return c.type === "externalEditor";
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Content types that represent real files on disk and should be persisted to session. */
export function isPersistableContent(c: PaneContent): c is EditorContent {
  return c.type === "editor" && !c.isVirtual;
}

/** Content types that are virtual (not backed by a real file on disk). */
const VIRTUAL_TYPES: ReadonlySet<PaneContentType> = new Set([
  "terminal",
  "agent",
  "webViewer",
  "newTab",
  "pullRequest",
]);

export function isVirtualContent(c: PaneContent): boolean {
  if (VIRTUAL_TYPES.has(c.type)) return true;
  if (c.type === "editor") return c.isVirtual;
  return false;
}

/** Whether this content type has editable text content with dirty tracking. */
export function isEditableContent(c: PaneContent): c is EditorContent | DiffContent {
  return c.type === "editor" || c.type === "diff";
}

/** Whether this content has text content (for search, etc.) */
export function hasTextContent(
  c: PaneContent,
): c is
  | EditorContent
  | DiffContent
  | MarkdownPreviewContent
  | HtmlPreviewContent
  | CsvPreviewContent {
  return (
    c.type === "editor" ||
    c.type === "diff" ||
    c.type === "markdownPreview" ||
    c.type === "htmlPreview" ||
    c.type === "csvPreview"
  );
}

/** Whether the content type should trigger LSP operations. */
export function shouldStartLsp(c: PaneContent): c is EditorContent {
  return c.type === "editor" && !c.isVirtual;
}

// ── Open spec (input to openContent) ────────────────────────────────

export type OpenContentSpec =
  | {
      type: "editor";
      path: string;
      name: string;
      content: string;
      isVirtual?: boolean;
      isPreview?: boolean;
      language?: string;
    }
  | {
      type: "terminal";
      name?: string;
      command?: string;
      workingDirectory?: string;
      remoteConnectionId?: string;
    }
  | { type: "agent"; sessionId?: string }
  | { type: "webViewer"; url: string }
  | { type: "newTab" }
  | {
      type: "diff";
      path: string;
      name: string;
      content: string;
      diffData?: GitDiff | MultiFileDiff;
    }
  | { type: "image"; path: string; name: string }
  | { type: "pdf"; path: string; name: string }
  | { type: "binary"; path: string; name: string }
  | {
      type: "database";
      path: string;
      name: string;
      databaseType: DatabaseType;
      connectionId?: string;
    }
  | { type: "pullRequest"; prNumber: number }
  | {
      type: "markdownPreview";
      path: string;
      name: string;
      content: string;
      sourceFilePath: string;
    }
  | {
      type: "htmlPreview";
      path: string;
      name: string;
      content: string;
      sourceFilePath: string;
    }
  | {
      type: "csvPreview";
      path: string;
      name: string;
      content: string;
      sourceFilePath: string;
    }
  | {
      type: "externalEditor";
      path: string;
      name: string;
      terminalConnectionId: string;
    };
