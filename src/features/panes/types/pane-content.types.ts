import type { DatabaseType } from "@/features/database/types/provider.types";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitDiff } from "@/features/git/types/git.types";
import type { OnboardingMode } from "@/features/onboarding/lib/onboarding-state";

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
  | "githubIssue"
  | "githubAction"
  | "githubForm"
  | "markdownDocument"
  | "markdownPreview"
  | "htmlPreview"
  | "csvPreview"
  | "externalEditor"
  | "globalSearch"
  | "diagnostics"
  | "references"
  | "extensions"
  | "onboarding";

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
  readOnly?: boolean;
  language?: string;
  languageOverride?: string;
  tokens: TokenEntry[];
}

export interface TerminalContent extends PaneContentBase {
  type: "terminal";
  sessionId: string;
  shell?: string;
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
  zoomLevel?: number;
  profileKey?: string;
  history?: string[];
  historyIndex?: number;
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

interface ImageContent extends PaneContentBase {
  type: "image";
}

interface PdfContent extends PaneContentBase {
  type: "pdf";
}

interface BinaryContent extends PaneContentBase {
  type: "binary";
}

interface DatabaseContent extends PaneContentBase {
  type: "database";
  databaseType: DatabaseType;
  connectionId?: string;
}

export interface PullRequestContent extends PaneContentBase {
  type: "pullRequest";
  repoPath?: string;
  prNumber: number;
  authorAvatarUrl?: string;
}

interface GitHubIssueContent extends PaneContentBase {
  type: "githubIssue";
  repoPath?: string;
  issueNumber: number;
  authorAvatarUrl?: string;
  url?: string;
}

interface GitHubActionContent extends PaneContentBase {
  type: "githubAction";
  repoPath?: string;
  runId: number;
  url?: string;
}

export interface GitHubFormContent extends PaneContentBase {
  type: "githubForm";
  repoPath: string;
  formKind: "pull-request" | "issue" | "action";
  operation: "create";
  defaultHead?: string;
}

export interface MarkdownDocumentContent extends PaneContentBase {
  type: "markdownDocument";
  content: string;
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

interface ExternalEditorContent extends PaneContentBase {
  type: "externalEditor";
  terminalConnectionId: string;
}

interface GlobalSearchContent extends PaneContentBase {
  type: "globalSearch";
}

interface DiagnosticsContent extends PaneContentBase {
  type: "diagnostics";
}

interface ReferencesContent extends PaneContentBase {
  type: "references";
}

interface ExtensionsContent extends PaneContentBase {
  type: "extensions";
}

interface OnboardingContent extends PaneContentBase {
  type: "onboarding";
  mode: OnboardingMode;
  currentVersion: string;
  previousVersion?: string;
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
  | GitHubIssueContent
  | GitHubActionContent
  | GitHubFormContent
  | MarkdownDocumentContent
  | MarkdownPreviewContent
  | HtmlPreviewContent
  | CsvPreviewContent
  | ExternalEditorContent
  | GlobalSearchContent
  | DiagnosticsContent
  | ReferencesContent
  | ExtensionsContent
  | OnboardingContent;

// ── Type guards ─────────────────────────────────────────────────────

export function isEditorContent(c: PaneContent): c is EditorContent {
  return c.type === "editor";
}

export function isWebViewerContent(c: PaneContent): c is WebViewerContent {
  return c.type === "webViewer";
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Content types that are virtual (not backed by a real file on disk). */
const VIRTUAL_TYPES: ReadonlySet<PaneContentType> = new Set([
  "terminal",
  "agent",
  "webViewer",
  "newTab",
  "pullRequest",
  "githubIssue",
  "githubAction",
  "githubForm",
  "markdownDocument",
  "globalSearch",
  "diagnostics",
  "references",
  "extensions",
  "onboarding",
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
  | MarkdownDocumentContent
  | MarkdownPreviewContent
  | HtmlPreviewContent
  | CsvPreviewContent {
  return (
    c.type === "editor" ||
    c.type === "diff" ||
    c.type === "markdownDocument" ||
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
      readOnly?: boolean;
      language?: string;
    }
  | {
      type: "terminal";
      name?: string;
      shell?: string;
      command?: string;
      workingDirectory?: string;
      remoteConnectionId?: string;
      sessionId?: string;
      path?: string;
    }
  | { type: "agent"; sessionId?: string }
  | {
      type: "webViewer";
      url: string;
      zoomLevel?: number;
      profileKey?: string;
      history?: string[];
      historyIndex?: number;
    }
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
  | {
      type: "pullRequest";
      prNumber: number;
      repoPath?: string;
      authorAvatarUrl?: string;
      name?: string;
      selectedFilePath?: string;
      initialView?: "activity" | "files";
    }
  | {
      type: "githubIssue";
      issueNumber: number;
      repoPath?: string;
      authorAvatarUrl?: string;
      name?: string;
      url?: string;
    }
  | {
      type: "githubAction";
      runId: number;
      repoPath?: string;
      name?: string;
      url?: string;
    }
  | {
      type: "githubForm";
      repoPath: string;
      formKind: "pull-request" | "issue" | "action";
      operation: "create";
      defaultHead?: string;
    }
  | {
      type: "markdownDocument";
      documentId: string;
      content?: string;
    }
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
    }
  | {
      type: "globalSearch";
    }
  | {
      type: "diagnostics";
    }
  | {
      type: "references";
    }
  | {
      type: "extensions";
    }
  | {
      type: "onboarding";
      context: import("@/features/onboarding/lib/onboarding-state").OnboardingContext;
    };
