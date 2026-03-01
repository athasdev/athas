import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useRepositoryStore } from "@/features/git/stores/repository-store";
import { toast } from "@/stores/toast-store";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { usePRDiffHighlighting } from "../hooks/use-pr-diff-highlighting";
import { useGitHubStore } from "../store";
import type { Label, LinkedIssue, PullRequestFile, ReviewRequest } from "../types";
import GitHubMarkdown from "./github-markdown";
import {
  AssigneesList,
  CIStatusIndicator,
  LabelBadges,
  LinkedIssuesList,
  MergeStatusBadge,
  ReviewRequestsList,
} from "./pr-status";

interface FileDiff {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified" | "renamed";
  lines?: string[];
}

interface Commit {
  oid: string;
  messageHeadline: string;
  messageBody: string;
  authoredDate: string;
  url?: string;
  authors: { login: string; name: string; email: string }[];
}

interface FilePatchData {
  path: string;
  oldPath?: string;
  status: FileDiff["status"];
  lines: string[];
}

interface DiffSectionRef {
  start: number;
  end: number;
  oldPath: string;
  newPath: string;
}

type DiffSectionIndex = Record<string, DiffSectionRef>;

const EXPAND_ALL_EAGER_PATCH_LIMIT = 10;
const EXPANDED_PATCH_BACKGROUND_BATCH = 4;

function inferFileStatus(additions: number, deletions: number): FileDiff["status"] {
  if (additions > 0 && deletions === 0) return "added";
  if (deletions > 0 && additions === 0) return "deleted";
  return "modified";
}

function toFileDiffFromMetadata(file: PullRequestFile): FileDiff {
  return {
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    status: inferFileStatus(file.additions, file.deletions),
  };
}

function buildDiffSectionIndex(diffText: string): DiffSectionIndex {
  if (!diffText) return {};

  const headerRegex = /^diff --git a\/(.+?) b\/(.+)$/gm;
  const headers: Array<Pick<DiffSectionRef, "start" | "oldPath" | "newPath">> = [];
  for (let match = headerRegex.exec(diffText); match !== null; match = headerRegex.exec(diffText)) {
    headers.push({
      start: match.index,
      oldPath: match[1],
      newPath: match[2],
    });
  }

  if (headers.length === 0) return {};

  const index: DiffSectionIndex = {};
  for (let i = 0; i < headers.length; i += 1) {
    const current = headers[i];
    const next = headers[i + 1];
    const sectionRef: DiffSectionRef = {
      start: current.start,
      end: next ? next.start : diffText.length,
      oldPath: current.oldPath,
      newPath: current.newPath,
    };

    if (!index[current.newPath]) {
      index[current.newPath] = sectionRef;
    }
    if (current.oldPath !== current.newPath && !index[current.oldPath]) {
      index[current.oldPath] = sectionRef;
    }
  }

  return index;
}

function extractFilePatch(
  diffText: string,
  targetPath: string,
  sectionIndex: DiffSectionIndex,
): FilePatchData | null {
  if (!diffText || !targetPath) return null;
  const sectionRef = sectionIndex[targetPath];
  if (!sectionRef) return null;

  const section = diffText.slice(sectionRef.start, sectionRef.end);

  const lines = section.split("\n");
  if (lines.length === 0) return null;

  const oldPath = sectionRef.oldPath;
  const newPath = sectionRef.newPath;
  const patchLines: string[] = [];
  let status: FileDiff["status"] = oldPath !== newPath ? "renamed" : "modified";
  let inPatch = false;

  for (const line of lines.slice(1)) {
    if (line.startsWith("new file mode")) {
      status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      status = "deleted";
      continue;
    }
    if (line.startsWith("@@")) {
      inPatch = true;
      patchLines.push(line);
      continue;
    }
    if (inPatch) {
      patchLines.push(line);
    }
  }

  return {
    path: newPath,
    oldPath: oldPath !== newPath ? oldPath : undefined,
    status,
    lines: patchLines,
  };
}

function resolveSafeRepoFilePath(repoPath: string, relativePath: string): string | null {
  const normalizedBase = repoPath.replace(/[\\/]$/, "");
  const normalizedInput = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalizedBase || !normalizedInput) return null;
  if (/^[A-Za-z]:/.test(normalizedInput) || normalizedInput.startsWith("//")) return null;

  const segments = normalizedInput.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))
  ) {
    return null;
  }

  const separator = normalizedBase.includes("\\") ? "\\" : "/";
  return `${normalizedBase}${separator}${segments.join(separator)}`;
}

function getCommentKey(comment: {
  author: { login: string };
  createdAt: string;
  body: string;
}): string {
  return `${comment.author.login}:${comment.createdAt}:${comment.body.slice(0, 32)}`;
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeCommitAuthor(value: unknown): Commit["authors"][number] | null {
  const record = asRecord(value);
  if (!record) return null;

  return {
    login: asNonEmptyString(record.login) ?? "",
    name: asNonEmptyString(record.name) ?? "",
    email: asNonEmptyString(record.email) ?? "",
  };
}

function normalizeCommit(raw: unknown, index: number): Commit | null {
  const record = asRecord(raw);
  if (!record) return null;

  const oid =
    asNonEmptyString(record.oid) ??
    asNonEmptyString(record.sha) ??
    asNonEmptyString(record.id) ??
    `commit-${index + 1}`;

  const fullMessage = asNonEmptyString(record.message) ?? "";
  const firstMessageLine = fullMessage.split("\n")[0]?.trim();
  const messageHeadline =
    asNonEmptyString(record.messageHeadline) ??
    asNonEmptyString(record.title) ??
    firstMessageLine ??
    oid.slice(0, 7);

  const messageBody =
    asNonEmptyString(record.messageBody) ??
    (fullMessage.includes("\n") ? fullMessage.split("\n").slice(1).join("\n").trim() : "");

  const authoredDate =
    asNonEmptyString(record.authoredDate) ??
    asNonEmptyString(record.committedDate) ??
    asNonEmptyString(record.committedAt) ??
    asNonEmptyString(record.createdAt) ??
    new Date().toISOString();

  const authorsField = record.authors;
  const authorsRecord = asRecord(authorsField);
  const rawAuthors = (Array.isArray(authorsField) ? authorsField : null) ??
    (authorsRecord && Array.isArray(authorsRecord.nodes) ? authorsRecord.nodes : null) ?? [
      record.author,
    ];
  const normalizedAuthors = rawAuthors
    .map(normalizeCommitAuthor)
    .filter((author): author is Commit["authors"][number] => !!author);

  return {
    oid,
    messageHeadline,
    messageBody,
    authoredDate,
    url: asNonEmptyString(record.url) ?? undefined,
    authors: normalizedAuthors,
  };
}

async function copyToClipboard(value: string, successMessage: string) {
  try {
    await writeText(value);
    toast.success(successMessage);
  } catch {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch (error) {
      toast.error(`Failed to copy: ${String(error)}`);
    }
  }
}

/**
 * Render content with syntax highlighting tokens
 */
function renderTokenizedContent(content: string, tokens: HighlightToken[]): ReactNode[] {
  if (!content || tokens.length === 0) {
    return [content];
  }

  const sortedTokens = [...tokens].sort((a, b) => {
    const startDiff = a.startPosition.column - b.startPosition.column;
    if (startDiff !== 0) return startDiff;
    const aSize = a.endPosition.column - a.startPosition.column;
    const bSize = b.endPosition.column - b.startPosition.column;
    return aSize - bSize;
  });

  const result: ReactNode[] = [];
  let currentPos = 0;

  for (const token of sortedTokens) {
    const start = token.startPosition.column;
    const end = token.endPosition.column;

    if (start >= content.length) continue;
    if (start < currentPos) continue;

    if (start > currentPos) {
      result.push(content.slice(currentPos, start));
    }

    const tokenEnd = Math.min(end, content.length);
    if (tokenEnd > start) {
      const tokenText = content.slice(start, tokenEnd);
      if (token.type === "token-text") {
        result.push(tokenText);
      } else {
        result.push(
          <span key={`${start}-${tokenEnd}`} className={token.type}>
            {tokenText}
          </span>,
        );
      }
    }

    currentPos = Math.max(currentPos, tokenEnd);
  }

  if (currentPos < content.length) {
    result.push(content.slice(currentPos));
  }

  return result;
}

interface DiffLineDisplayProps {
  line: string;
  index: number;
  tokens?: HighlightToken[];
}

const DiffLineDisplay = memo(({ line, index, tokens }: DiffLineDisplayProps) => {
  let bgClass = "";
  let textClass = "text-text";
  let content = line;

  if (line.startsWith("@@")) {
    bgClass = "bg-blue-500/10";
    textClass = "text-blue-400";
  } else if (line.startsWith("+")) {
    bgClass = "bg-git-added/10";
    textClass = tokens && tokens.length > 0 ? "text-text" : "text-git-added";
    content = line.slice(1);
  } else if (line.startsWith("-")) {
    bgClass = "bg-git-deleted/10";
    textClass = tokens && tokens.length > 0 ? "text-text" : "text-git-deleted";
    content = line.slice(1);
  }

  const renderContent = () => {
    if (tokens && tokens.length > 0) {
      return renderTokenizedContent(content, tokens);
    }
    return content || " ";
  };

  return (
    <div className={cn("px-3 py-0 font-mono text-[11px] leading-4", bgClass, textClass)}>
      <span className="mr-3 inline-block w-10 select-none text-right text-text-lighter/50">
        {index + 1}
      </span>
      <span className="whitespace-pre">{renderContent()}</span>
    </div>
  );
});

DiffLineDisplay.displayName = "DiffLineDisplay";

interface FileDiffViewProps {
  file: FileDiff;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenFile: (relativePath: string) => void;
  isLoadingPatch: boolean;
  patchError?: string;
}

const FileDiffView = memo(
  ({ file, isExpanded, onToggle, onOpenFile, isLoadingPatch, patchError }: FileDiffViewProps) => {
    const fileLines = file.lines ?? [];
    const tokenMap = usePRDiffHighlighting(isExpanded ? fileLines : [], file.path);
    const statusColors: Record<FileDiff["status"], string> = {
      added: "bg-git-added/15 text-git-added",
      deleted: "bg-git-deleted/15 text-git-deleted",
      modified: "bg-git-modified/15 text-git-modified",
      renamed: "bg-git-renamed/15 text-git-renamed",
    };

    return (
      <div className="min-w-0 overflow-hidden rounded-lg bg-secondary-bg/35">
        <button
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover/60"
        >
          {isExpanded ? (
            <ChevronDown size={14} className="text-text-lighter" />
          ) : (
            <ChevronRight size={14} className="text-text-lighter" />
          )}
          <FileText size={14} className="text-text-lighter" />
          <span className="min-w-0 flex-1 truncate text-text text-xs">{file.path}</span>
          {file.oldPath && (
            <span className="max-w-48 truncate text-[10px] text-text-lighter">
              from {file.oldPath}
            </span>
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] capitalize",
              statusColors[file.status],
            )}
          >
            {file.status}
          </span>
          <span className="text-[10px] text-git-added">+{file.additions}</span>
          <span className="text-[10px] text-git-deleted">-{file.deletions}</span>
        </button>
        {isExpanded && (
          <div className="bg-primary-bg/65">
            <div className="flex items-center justify-between px-3 py-1.5">
              <Tooltip content="Open file in editor" side="top">
                <button
                  onClick={() => onOpenFile(file.path)}
                  className="rounded-md border border-border/70 bg-secondary-bg/70 px-2 py-1 text-[10px] text-text-lighter hover:bg-hover hover:text-text"
                >
                  Open File
                </button>
              </Tooltip>
              <span className="text-[10px] text-text-lighter">
                {isLoadingPatch ? "Loading patch..." : `${fileLines.length} diff lines`}
              </span>
            </div>
            <div className="max-h-[540px] overflow-auto">
              {isLoadingPatch ? (
                <div className="flex items-center justify-center py-6">
                  <RefreshCw size={14} className="animate-spin text-text-lighter" />
                  <span className="ml-2 text-text-lighter text-xs">Loading file diff...</span>
                </div>
              ) : patchError ? (
                <div className="px-3 py-4 text-center text-error text-xs">{patchError}</div>
              ) : fileLines.length === 0 ? (
                <div className="px-3 py-4 text-center text-text-lighter text-xs">
                  No diff hunks available for this file.
                </div>
              ) : (
                fileLines.map((line, index) => (
                  <DiffLineDisplay
                    key={index}
                    line={line}
                    index={index}
                    tokens={tokenMap.get(index)}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);

FileDiffView.displayName = "FileDiffView";

interface CommitItemProps {
  commit: Commit;
}

const CommitItem = memo(({ commit }: CommitItemProps) => {
  const author = commit.authors[0];
  const shortSha = commit.oid.slice(0, 7);
  const authorName = author?.login || author?.name || "Unknown";
  const avatarLogin = (author?.login || "").trim();

  return (
    <div className="flex items-start gap-3 rounded-lg bg-secondary-bg/35 px-4 py-3 hover:bg-hover/50">
      <img
        src={`https://github.com/${encodeURIComponent(avatarLogin || "github")}.png?size=32`}
        alt={authorName}
        className="h-6 w-6 shrink-0 rounded-full bg-secondary-bg"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text">{commit.messageHeadline}</p>
        {commit.messageBody && (
          <div className="mt-1">
            <GitHubMarkdown content={commit.messageBody} className="text-text-lighter text-xs" />
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-text-lighter text-xs">
          <span className="font-medium">{authorName}</span>
          <span>committed {getTimeAgo(commit.authoredDate)}</span>
          <code className="rounded bg-primary-bg px-1.5 py-0.5 font-mono">{shortSha}</code>
          <Tooltip content="Copy full commit SHA" side="top">
            <button
              onClick={() => void copyToClipboard(commit.oid, "Commit SHA copied")}
              className="rounded border border-transparent p-0.5 text-text-lighter hover:border-border hover:bg-hover hover:text-text"
              aria-label="Copy commit SHA"
            >
              <Copy size={11} />
            </button>
          </Tooltip>
          {commit.url && (
            <Tooltip content="Open commit on GitHub" side="top">
              <button
                onClick={() => window.open(commit.url, "_blank", "noopener,noreferrer")}
                className="rounded border border-transparent p-0.5 text-text-lighter hover:border-border hover:bg-hover hover:text-text"
                aria-label="Open commit in browser"
              >
                <ExternalLink size={11} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
});

CommitItem.displayName = "CommitItem";

interface CommentItemProps {
  comment: {
    author: { login: string };
    body: string;
    createdAt: string;
  };
}

const CommentItem = memo(({ comment }: CommentItemProps) => {
  const authorLogin = comment.author.login;

  return (
    <div className="flex gap-3 rounded-lg bg-secondary-bg/35 px-4 py-4">
      <img
        src={`https://github.com/${authorLogin}.png?size=40`}
        alt={authorLogin}
        className="h-8 w-8 shrink-0 rounded-full bg-secondary-bg"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-text">{authorLogin}</span>
          <span className="text-text-lighter text-xs">{getTimeAgo(comment.createdAt)}</span>
        </div>
        <div className="mt-2">
          <GitHubMarkdown content={comment.body} />
        </div>
      </div>
    </div>
  );
});

CommentItem.displayName = "CommentItem";

interface PRViewerProps {
  prNumber: number;
}

type TabType = "description" | "files" | "commits" | "comments";
type FileStatusFilter = "all" | "added" | "deleted" | "modified" | "renamed";
type FilePatchState = {
  loading: boolean;
  error?: string;
  data?: FilePatchData;
};

const PRViewer = memo(({ prNumber }: PRViewerProps) => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const selectedRepoPath = useRepositoryStore.use.activeRepoPath();
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const {
    selectedPRDetails,
    selectedPRDiff,
    selectedPRFiles,
    selectedPRComments,
    isLoadingDetails,
    isLoadingContent,
    detailsError,
    contentError,
  } = useGitHubStore();
  const { selectPR, fetchPRContent, openPRInBrowser, checkoutPR } = useGitHubStore().actions;
  const repoPath = selectedRepoPath ?? rootFolderPath;

  const [activeTab, setActiveTab] = useState<TabType>("description");
  const [fileQuery, setFileQuery] = useState("");
  const [fileStatusFilter, setFileStatusFilter] = useState<FileStatusFilter>("all");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [filePatches, setFilePatches] = useState<Record<string, FilePatchState>>({});
  const patchLoadSeqRef = useRef(0);
  const [, startTabTransition] = useTransition();

  // Load PR data when component mounts
  useEffect(() => {
    if (repoPath && prNumber) {
      void selectPR(repoPath, prNumber);
    }
  }, [repoPath, prNumber, selectPR]);

  useEffect(() => {
    setActiveTab("description");
    setExpandedFiles(new Set());
    setFilePatches({});
    patchLoadSeqRef.current += 1;
  }, [prNumber, repoPath]);

  useEffect(() => {
    if (!repoPath || !prNumber) return;
    if (activeTab === "files") {
      void fetchPRContent(repoPath, prNumber, { mode: "files" });
    } else if (activeTab === "comments") {
      void fetchPRContent(repoPath, prNumber, { mode: "comments" });
    }
  }, [activeTab, repoPath, prNumber, fetchPRContent]);

  const baseDiffFiles = useMemo(() => {
    return selectedPRFiles.map(toFileDiffFromMetadata);
  }, [selectedPRFiles]);

  const baseDiffByPath = useMemo(() => {
    return new Map(baseDiffFiles.map((file) => [file.path, file]));
  }, [baseDiffFiles]);

  const diffSectionIndex = useMemo(() => {
    return buildDiffSectionIndex(selectedPRDiff ?? "");
  }, [selectedPRDiff]);

  const diffFiles = useMemo(() => {
    return baseDiffFiles.map((file) => {
      const patch = filePatches[file.path];
      return {
        ...file,
        oldPath: patch?.data?.oldPath ?? file.oldPath,
        status: patch?.data?.status ?? file.status,
        lines: patch?.data?.lines,
      };
    });
  }, [baseDiffFiles, filePatches]);

  const commits = useMemo(() => {
    if (!Array.isArray(selectedPRDetails?.commits)) return [];
    return selectedPRDetails.commits
      .map((commit, index) => normalizeCommit(commit, index))
      .filter((commit): commit is Commit => !!commit);
  }, [selectedPRDetails?.commits]);

  const deferredFileQuery = useDeferredValue(fileQuery);
  const filteredDiff = useMemo(() => {
    const query = deferredFileQuery.trim().toLowerCase();
    return diffFiles.filter((file) => {
      if (fileStatusFilter !== "all" && file.status !== fileStatusFilter) return false;
      if (!query) return true;
      return (
        file.path.toLowerCase().includes(query) ||
        file.oldPath?.toLowerCase().includes(query) ||
        false
      );
    });
  }, [diffFiles, deferredFileQuery, fileStatusFilter]);

  const handleOpenInBrowser = useCallback(() => {
    if (repoPath) {
      openPRInBrowser(repoPath, prNumber);
    }
  }, [repoPath, prNumber, openPRInBrowser]);

  const handleCheckout = useCallback(async () => {
    if (repoPath) {
      try {
        await checkoutPR(repoPath, prNumber);
      } catch (err) {
        console.error("Failed to checkout PR:", err);
      }
    }
  }, [repoPath, prNumber, checkoutPR]);

  const handleRefresh = useCallback(() => {
    if (repoPath) {
      void selectPR(repoPath, prNumber, { force: true });
      if (activeTab === "files") {
        void fetchPRContent(repoPath, prNumber, { force: true, mode: "files" });
      } else if (activeTab === "comments") {
        void fetchPRContent(repoPath, prNumber, { force: true, mode: "comments" });
      }
    }
  }, [activeTab, repoPath, prNumber, selectPR, fetchPRContent]);

  const handleCopyPRLink = useCallback(() => {
    if (!selectedPRDetails?.url) {
      toast.error("PR link is not available.");
      return;
    }
    void copyToClipboard(selectedPRDetails.url, "PR link copied");
  }, [selectedPRDetails?.url]);

  const handleCopyBranchName = useCallback(() => {
    if (!selectedPRDetails?.headRef) {
      toast.error("Branch name is not available.");
      return;
    }
    void copyToClipboard(selectedPRDetails.headRef, "Branch name copied");
  }, [selectedPRDetails?.headRef]);

  const loadFilePatch = useCallback(
    (path: string) => {
      if (!selectedPRDiff) return;
      let shouldSchedule = false;
      setFilePatches((prev) => {
        const existing = prev[path];
        if (existing?.loading || existing?.data) {
          return prev;
        }
        shouldSchedule = true;
        return {
          ...prev,
          [path]: { ...(existing ?? {}), loading: true, error: undefined },
        };
      });
      if (!shouldSchedule) return;

      const loadSeq = patchLoadSeqRef.current;
      const run = () => {
        try {
          const patch = extractFilePatch(selectedPRDiff, path, diffSectionIndex);
          if (patchLoadSeqRef.current !== loadSeq) return;

          setFilePatches((prev) => ({
            ...prev,
            [path]: {
              loading: false,
              data: patch ?? {
                path,
                status: baseDiffByPath.get(path)?.status ?? "modified",
                lines: [],
              },
            },
          }));
        } catch (error) {
          if (patchLoadSeqRef.current !== loadSeq) return;
          setFilePatches((prev) => ({
            ...prev,
            [path]: {
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        }
      };

      if (typeof window !== "undefined") {
        const requestIdle = (
          window as Window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
          }
        ).requestIdleCallback;
        if (typeof requestIdle === "function") {
          requestIdle(() => run(), { timeout: 120 });
          return;
        }
      }
      window.setTimeout(run, 0);
    },
    [selectedPRDiff, diffSectionIndex, baseDiffByPath],
  );

  const handleToggleFileExpanded = useCallback(
    (path: string) => {
      let shouldLoad = false;
      setExpandedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          shouldLoad = true;
        }
        return next;
      });

      if (shouldLoad) {
        loadFilePatch(path);
      }
    },
    [loadFilePatch],
  );

  const handleExpandAllFiles = useCallback(() => {
    const paths = filteredDiff.map((file) => file.path);
    setExpandedFiles(new Set(paths));

    for (const path of paths.slice(0, EXPAND_ALL_EAGER_PATCH_LIMIT)) {
      loadFilePatch(path);
    }
  }, [filteredDiff, loadFilePatch]);

  const handleCollapseAllFiles = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  useEffect(() => {
    if (activeTab !== "files" || !selectedPRDiff || expandedFiles.size === 0) return;

    const missingPatches = Array.from(expandedFiles).filter((path) => {
      const patchState = filePatches[path];
      return !patchState?.loading && !patchState?.data && !patchState?.error;
    });
    if (missingPatches.length === 0) return;

    for (const path of missingPatches.slice(0, EXPANDED_PATCH_BACKGROUND_BATCH)) {
      loadFilePatch(path);
    }
  }, [activeTab, expandedFiles, filePatches, selectedPRDiff, loadFilePatch]);

  const handleOpenChangedFile = useCallback(
    (relativePath: string) => {
      if (!repoPath) {
        toast.error("No repository selected.");
        return;
      }

      const fullPath = resolveSafeRepoFilePath(repoPath, relativePath);
      if (!fullPath) {
        toast.error("Invalid file path in diff.");
        return;
      }

      void handleFileSelect(fullPath, false);
    },
    [repoPath, handleFileSelect],
  );

  if (isLoadingDetails && !selectedPRDetails) {
    return (
      <div className="flex h-full flex-col bg-primary-bg">
        <div className="flex flex-1 items-center justify-center">
          <RefreshCw size={20} className="animate-spin text-text-lighter" />
          <span className="ml-2 text-sm text-text-lighter">Loading PR #{prNumber}...</span>
        </div>
      </div>
    );
  }

  if (detailsError && !selectedPRDetails) {
    return (
      <div className="flex h-full flex-col bg-primary-bg">
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
          <p className="text-error text-sm">{detailsError}</p>
          <button
            onClick={handleRefresh}
            className="mt-3 rounded bg-hover px-4 py-2 text-sm text-text hover:bg-selected"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!selectedPRDetails) {
    return null;
  }

  const isRefreshingDetails = isLoadingDetails && !!selectedPRDetails;
  const pr = selectedPRDetails;
  const changedFilesCount = pr.changedFiles || selectedPRFiles.length || 0;

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      {isRefreshingDetails && (
        <div className="h-px w-full overflow-hidden bg-border">
          <div className="h-full w-1/3 animate-pulse bg-accent/70" />
        </div>
      )}
      {/* Header */}
      <div className="shrink-0 bg-secondary-bg/60 px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              <GitPullRequest
                size={18}
                className={cn(
                  "mt-0.5 shrink-0",
                  pr.state === "MERGED"
                    ? "text-purple-500"
                    : pr.state === "CLOSED"
                      ? "text-red-500"
                      : "text-green-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-border bg-primary-bg/70 px-1.5 py-0.5 font-mono text-[11px] text-text-lighter">
                    #{pr.number}
                  </span>
                  <h1 className="min-w-0 break-words font-medium text-sm text-text sm:text-base">
                    {pr.title}
                  </h1>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-lighter">
                  <span className="font-medium text-text-light">@{pr.author.login}</span>
                  <span>opened {getTimeAgo(pr.createdAt)}</span>
                  <span>updated {getTimeAgo(pr.updatedAt)}</span>
                  <div className="flex min-w-0 items-center gap-1 rounded-md border border-border/70 bg-primary-bg/65 px-1.5 py-0.5">
                    <GitBranch size={11} />
                    <span className="truncate font-mono text-[10px]">
                      {pr.headRef} → {pr.baseRef}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded-md border border-border bg-primary-bg/70 px-2 py-1 text-text-lighter">
                    {changedFilesCount} files
                  </span>
                  <span className="rounded-md bg-git-added/15 px-2 py-1 text-git-added">
                    +{pr.additions}
                  </span>
                  <span className="rounded-md bg-git-deleted/15 px-2 py-1 text-git-deleted">
                    -{pr.deletions}
                  </span>
                  <span className="rounded-md border border-border bg-primary-bg/70 px-2 py-1 text-text-lighter">
                    {commits.length} commits
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {pr.isDraft && (
              <span className="rounded-md border border-border bg-primary-bg/70 px-2 py-1 text-[10px] text-text-lighter">
                Draft
              </span>
            )}
            {pr.reviewDecision && (
              <span
                className={cn(
                  "rounded-md px-2 py-1 text-[10px]",
                  pr.reviewDecision === "APPROVED"
                    ? "bg-green-500/20 text-green-500"
                    : pr.reviewDecision === "CHANGES_REQUESTED"
                      ? "bg-red-500/20 text-red-500"
                      : "bg-yellow-500/20 text-yellow-500",
                )}
              >
                {pr.reviewDecision === "APPROVED"
                  ? "Approved"
                  : pr.reviewDecision === "CHANGES_REQUESTED"
                    ? "Changes Requested"
                    : "Review Required"}
              </span>
            )}
            <Tooltip content="Refresh PR data" side="bottom">
              <button
                onClick={handleRefresh}
                disabled={isRefreshingDetails}
                className="rounded-md border border-transparent p-2 text-text-lighter hover:border-border/70 hover:bg-hover hover:text-text"
                aria-label="Refresh PR data"
              >
                <RefreshCw size={14} className={isRefreshingDetails ? "animate-spin" : ""} />
              </button>
            </Tooltip>
            <Tooltip content="Checkout PR branch" side="bottom">
              <button
                onClick={handleCheckout}
                className="rounded-md border border-transparent p-2 text-text-lighter hover:border-border/70 hover:bg-hover hover:text-text"
                aria-label="Checkout PR branch"
              >
                <GitBranch size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Open on GitHub" side="bottom">
              <button
                onClick={handleOpenInBrowser}
                className="rounded-md border border-transparent p-2 text-text-lighter hover:border-border/70 hover:bg-hover hover:text-text"
                aria-label="Open pull request in browser"
              >
                <ExternalLink size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Copy PR link" side="bottom">
              <button
                onClick={handleCopyPRLink}
                className="rounded-md border border-transparent p-2 text-text-lighter hover:border-border/70 hover:bg-hover hover:text-text"
                aria-label="Copy PR link"
              >
                <Copy size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Copy branch name" side="bottom">
              <button
                onClick={handleCopyBranchName}
                className="rounded-md border border-transparent p-2 text-text-lighter hover:border-border/70 hover:bg-hover hover:text-text"
                aria-label="Copy branch name"
              >
                <GitBranch size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Status bar */}
      {(pr.statusChecks?.length > 0 ||
        pr.mergeStateStatus ||
        pr.linkedIssues?.length > 0 ||
        pr.reviewRequests?.length > 0 ||
        pr.labels?.length > 0 ||
        pr.assignees?.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 bg-secondary-bg/45 px-4 py-2">
          {pr.statusChecks && pr.statusChecks.length > 0 && (
            <CIStatusIndicator checks={pr.statusChecks} />
          )}
          <MergeStatusBadge
            mergeStateStatus={pr.mergeStateStatus}
            mergeable={pr.mergeable}
            reviewDecision={pr.reviewDecision}
          />
          {pr.linkedIssues && pr.linkedIssues.length > 0 && (
            <LinkedIssuesList issues={pr.linkedIssues as LinkedIssue[]} />
          )}
          {pr.reviewRequests && pr.reviewRequests.length > 0 && (
            <ReviewRequestsList reviewRequests={pr.reviewRequests as ReviewRequest[]} />
          )}
          {pr.labels && pr.labels.length > 0 && <LabelBadges labels={pr.labels as Label[]} />}
          {pr.assignees && pr.assignees.length > 0 && <AssigneesList assignees={pr.assignees} />}
        </div>
      )}
      {detailsError && (
        <div className="flex shrink-0 items-center justify-between gap-2 bg-error/8 px-4 py-2">
          <p className="truncate text-[11px] text-error/90">{detailsError}</p>
          <button
            onClick={handleRefresh}
            className="shrink-0 rounded-md border border-error/40 px-2 py-1 text-[10px] text-error/90 hover:bg-error/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="shrink-0 bg-secondary-bg/55 px-3 py-2 sm:px-4">
        <div className="scrollbar-hidden flex min-w-0 overflow-x-auto">
          <div className="inline-flex items-center gap-1 rounded-xl border border-border/70 bg-primary-bg/55 p-1">
            <Tooltip content="PR description" side="bottom">
              <button
                onClick={() =>
                  startTabTransition(() => {
                    setActiveTab("description");
                  })
                }
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors",
                  activeTab === "description"
                    ? "border border-border/80 bg-primary-bg text-text"
                    : "text-text-lighter hover:bg-hover hover:text-text",
                )}
              >
                <FileText size={13} />
                Description
              </button>
            </Tooltip>
            <Tooltip content="Changed files and diff" side="bottom">
              <button
                onClick={() =>
                  startTabTransition(() => {
                    setActiveTab("files");
                  })
                }
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors",
                  activeTab === "files"
                    ? "border border-border/80 bg-primary-bg text-text"
                    : "text-text-lighter hover:bg-hover hover:text-text",
                )}
              >
                <FileText size={13} />
                Files
                <span className="rounded bg-secondary-bg px-1.5 py-0.5 text-[10px] text-text-lighter">
                  {changedFilesCount}
                </span>
              </button>
            </Tooltip>
            <Tooltip content="Commits in this PR" side="bottom">
              <button
                onClick={() =>
                  startTabTransition(() => {
                    setActiveTab("commits");
                  })
                }
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors",
                  activeTab === "commits"
                    ? "border border-border/80 bg-primary-bg text-text"
                    : "text-text-lighter hover:bg-hover hover:text-text",
                )}
              >
                <GitCommit size={13} />
                Commits
                <span className="rounded bg-secondary-bg px-1.5 py-0.5 text-[10px] text-text-lighter">
                  {commits.length}
                </span>
              </button>
            </Tooltip>
            <Tooltip content="Discussion and comments" side="bottom">
              <button
                onClick={() =>
                  startTabTransition(() => {
                    setActiveTab("comments");
                  })
                }
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors",
                  activeTab === "comments"
                    ? "border border-border/80 bg-primary-bg text-text"
                    : "text-text-lighter hover:bg-hover hover:text-text",
                )}
              >
                <MessageSquare size={13} />
                Comments
                <span className="rounded bg-secondary-bg px-1.5 py-0.5 text-[10px] text-text-lighter">
                  {selectedPRComments.length}
                </span>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Description Tab */}
        {activeTab === "description" && (
          <div className="p-3 sm:p-4">
            {pr.body ? (
              <div className="rounded-xl border border-border/60 bg-secondary-bg/35 p-3 sm:p-4">
                <GitHubMarkdown content={pr.body} />
              </div>
            ) : (
              <p className="text-sm text-text-lighter italic">No description provided</p>
            )}
          </div>
        )}

        {/* Files Tab */}
        {activeTab === "files" && (
          <div className="min-w-0 p-3 sm:p-4">
            <div className="mb-3 rounded-xl border border-border/60 bg-secondary-bg/35 p-2.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleExpandAllFiles}
                    className="rounded-md border border-border/70 bg-primary-bg/70 px-2 py-1 text-[10px] text-text-lighter hover:bg-hover hover:text-text"
                  >
                    Expand All
                  </button>
                  <button
                    onClick={handleCollapseAllFiles}
                    className="rounded-md border border-border/70 bg-primary-bg/70 px-2 py-1 text-[10px] text-text-lighter hover:bg-hover hover:text-text"
                  >
                    Collapse All
                  </button>
                  <span className="rounded-md border border-border/70 bg-primary-bg/70 px-2 py-1 text-[10px] text-text-lighter">
                    {filteredDiff.length} of {diffFiles.length} files
                  </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative">
                    <Search
                      size={12}
                      className="-translate-y-1/2 absolute top-1/2 left-2 text-text-lighter"
                    />
                    <input
                      value={fileQuery}
                      onChange={(e) => setFileQuery(e.target.value)}
                      placeholder="Search changed files..."
                      className="ui-font h-8 w-full rounded-md border border-border/70 bg-primary-bg/70 pr-2 pl-7 text-text text-xs placeholder:text-text-lighter focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 sm:w-56"
                    />
                  </div>
                  <div className="relative">
                    <SlidersHorizontal
                      size={12}
                      className="-translate-y-1/2 absolute top-1/2 left-2 text-text-lighter"
                    />
                    <select
                      value={fileStatusFilter}
                      onChange={(e) => setFileStatusFilter(e.target.value as FileStatusFilter)}
                      className="ui-font h-8 w-full appearance-none rounded-md border border-border/70 bg-primary-bg/70 pr-7 pl-7 text-text text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 sm:w-40"
                    >
                      <option value="all">All statuses</option>
                      <option value="added">Added</option>
                      <option value="modified">Modified</option>
                      <option value="deleted">Deleted</option>
                      <option value="renamed">Renamed</option>
                    </select>
                    <ChevronDown
                      size={12}
                      className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2 text-text-lighter"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-secondary-bg/35 p-1">
              {isLoadingContent && !selectedPRDiff ? (
                <div className="flex items-center justify-center p-8">
                  <RefreshCw size={16} className="animate-spin text-text-lighter" />
                  <span className="ml-2 text-text-lighter text-xs">Loading diff...</span>
                </div>
              ) : contentError ? (
                <div className="flex items-center justify-center p-8 text-center">
                  <div>
                    <p className="text-error text-xs">{contentError}</p>
                    <button
                      onClick={handleRefresh}
                      className="mt-2 rounded-md border border-error/40 px-2 py-1 text-[10px] text-error/90 hover:bg-error/10"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : diffFiles.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                  <p className="text-sm text-text-lighter">No file changes</p>
                </div>
              ) : filteredDiff.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                  <p className="text-sm text-text-lighter">No files match your filters</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredDiff.map((file) => (
                    <FileDiffView
                      key={file.path}
                      file={file}
                      isExpanded={expandedFiles.has(file.path)}
                      onToggle={() => handleToggleFileExpanded(file.path)}
                      onOpenFile={handleOpenChangedFile}
                      isLoadingPatch={!!filePatches[file.path]?.loading}
                      patchError={filePatches[file.path]?.error}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Commits Tab */}
        {activeTab === "commits" && (
          <div className="p-3 sm:p-4">
            <div className="rounded-xl border border-border/60 bg-secondary-bg/35 p-1">
              {commits.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                  <p className="text-sm text-text-lighter">No commits</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {commits.map((commit) => (
                    <CommitItem key={commit.oid} commit={commit} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Comments Tab */}
        {activeTab === "comments" && (
          <div className="p-3 sm:p-4">
            <div className="rounded-xl border border-border/60 bg-secondary-bg/35 p-1">
              {isLoadingContent && selectedPRComments.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                  <RefreshCw size={16} className="animate-spin text-text-lighter" />
                  <span className="ml-2 text-text-lighter text-xs">Loading comments...</span>
                </div>
              ) : contentError ? (
                <div className="flex items-center justify-center p-8 text-center">
                  <div>
                    <p className="text-error text-xs">{contentError}</p>
                    <button
                      onClick={handleRefresh}
                      className="mt-2 rounded-md border border-error/40 px-2 py-1 text-[10px] text-error/90 hover:bg-error/10"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : selectedPRComments.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                  <p className="text-sm text-text-lighter">No comments</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {selectedPRComments.map((comment, index) => (
                    <CommentItem key={getCommentKey(comment) || `${index}`} comment={comment} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

PRViewer.displayName = "PRViewer";

export default PRViewer;
